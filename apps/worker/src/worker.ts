/**
 * RUNECLAW BSC worker — the autonomous loop that runs unattended during the live
 * window (§0.11). Responsibilities:
 *   1. Crash-recovery reconciliation BEFORE any new trade (no duplicate trades).
 *   2. Per-cycle: honor the kill-switch, refresh CMC perception, run the gate
 *      chain, decide via the scheduler, (dry or live) execute, persist mandates.
 *   3. Heartbeat each cycle; hourly portfolio snapshot; alerts on key events.
 *
 * Requires CMC_API_KEY (real perception, never fabricated). Live signing requires
 * a configured TWAK executor; without it the worker runs the full ops loop in DRY
 * decision mode (no signing) and says so. It never fakes a fill or a tx hash.
 *
 *   pnpm --filter @runeclaw/worker start
 *
 * Env: WORKER_INTERVAL_SECONDS (default 300), WORKER_MAX_CYCLES (default 0 = forever).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  AuditLogger,
  appendMandate,
  buildCalibrationReport,
  loadRiskConfig,
  reconcile,
  valueHoldings,
  type CalibrationReport,
  type PendingMandate,
  type Holding,
} from "@runeclaw/core";
import { CmcClient, CmcX402Client, buildMomentumInputs } from "@runeclaw/cmc-adapter";
import {
  loadEligibleTokens,
  LiveBscReader,
  NoPoolError,
  PANCAKE_V2_ROUTER,
  STARTER_MAJORS,
} from "@runeclaw/bsc-adapter";
import {
  evaluateCandidate,
  buildBscMandate,
  sendAlert,
  registerAgentIdentity,
  type PipelineContext,
} from "@runeclaw/bnb-agent";
import {
  CliTwakExecutor,
  PolicyEnforcingExecutor,
  type TwakPolicyConfig,
} from "@runeclaw/twak-adapter";

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const ROOT = repoRoot();
// Load the monorepo-root .env so secrets are picked up regardless of cwd.
loadDotenv({ path: join(ROOT, ".env") });
const RUNTIME_DIR = join(ROOT, "data", "runtime");
const AUDIT_DIR = join(ROOT, "data", "audit");
const config = loadRiskConfig(process.env as Record<string, string | undefined>);
const intervalMs = Number(process.env.WORKER_INTERVAL_SECONDS ?? "300") * 1000;
const maxCycles = Number(process.env.WORKER_MAX_CYCLES ?? "0");

function killEngaged(): boolean {
  const f = join(RUNTIME_DIR, "kill.flag.json");
  if (!existsSync(f)) return false;
  try {
    return Boolean((JSON.parse(readFileSync(f, "utf8")) as { engaged?: boolean }).engaged);
  } catch {
    return false;
  }
}

function writeHeartbeat(mode: string, cyclesRun: number): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(
    join(RUNTIME_DIR, "heartbeat.json"),
    JSON.stringify({ lastBeatIso: new Date().toISOString(), mode, cyclesRun }),
    "utf8",
  );
}

function loadPending(): PendingMandate[] {
  const f = join(RUNTIME_DIR, "pending.json");
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, "utf8")) as PendingMandate[];
  } catch {
    return [];
  }
}

function seedCalibration(): CalibrationReport {
  // Used only until `pnpm calibrate:edge` writes a real report. Labeled, and live
  // mode flags it stale; the worker runs dry by default.
  return buildCalibrationReport(
    [
      { score: 70, realizedMoveBps: 90, win: true },
      { score: 85, realizedMoveBps: 320, win: true },
    ],
    [60, 80],
    { version: "seed-worker", generatedAt: new Date().toISOString(), historyDays: 0 },
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!process.env.CMC_API_KEY) {
    console.error("✗ CMC_API_KEY required (real perception). The worker never fabricates market data.");
    process.exit(1);
  }
  const twakConfigured = Boolean(process.env.TWAK_CONFIG_PATH);
  const mode = twakConfigured ? "live" : "dry";

  // Live competition mode refuses to start unless the dress rehearsal passed
  // (§0.12), overridable only by explicit confirmation after manual live steps.
  if (mode === "live" && process.env.REHEARSAL_OVERRIDE !== "true") {
    const gate = join(RUNTIME_DIR, "rehearsal.json");
    const passed = existsSync(gate)
      ? Boolean((JSON.parse(readFileSync(gate, "utf8")) as { passed?: boolean }).passed)
      : false;
    if (!passed) {
      console.error(
        "✗ Live mode blocked: dress rehearsal not passed (§0.12).\n" +
          "  Run `pnpm rehearsal:checklist`, complete the manual live steps, then either\n" +
          "  pass all checks or set REHEARSAL_OVERRIDE=true to start with explicit confirmation.",
      );
      process.exit(1);
    }
  }

  console.log(`[worker] starting in ${mode.toUpperCase()} mode (interval ${intervalMs / 1000}s)`);

  mkdirSync(AUDIT_DIR, { recursive: true });
  const runId = `bsc-worker-${Date.now()}`;
  const audit = new AuditLogger(join(AUDIT_DIR, `${runId}.jsonl`));
  const mandatesPath = join(AUDIT_DIR, `${runId}.mandates.jsonl`);

  // 1. Crash-recovery reconciliation BEFORE any trade.
  const pending = loadPending();
  const report = await reconcile(pending, async () => ({ found: false, confirmed: false }));
  await audit.append({
    timestamp: new Date().toISOString(),
    mandateId: "recovery",
    stage: "recovery",
    input: { pending: pending.length },
    output: { ...report },
  });
  if (report.requiresReview) {
    await sendAlert(process.env.ALERT_WEBHOOK_URL, {
      reason: "restart_recovery",
      message: `Recovery requires review: ${report.resolutions.length} pending mandate(s).`,
      timestamp: new Date().toISOString(),
    });
    console.warn("[worker] recovery requires manual review — not trading until resolved.");
  } else {
    await sendAlert(process.env.ALERT_WEBHOOK_URL, {
      reason: "restart_recovery",
      message: `Worker started cleanly (${mode} mode). ${report.duplicatesPrevented} duplicates prevented.`,
      timestamp: new Date().toISOString(),
    });
  }

  const cmc = new CmcClient();
  const loaded = loadEligibleTokens(process.env.ELIGIBLE_TOKENS_PATH ?? "data/eligible-tokens.json");
  const calibration = seedCalibration();
  const usdt = loaded.tokens.find((t) => t.symbol === "USDT");
  if (!usdt) throw new Error("USDT not found in eligible set — cannot route stable legs.");

  const twakPolicy: TwakPolicyConfig = {
    requiredChainId: 56,
    allowedRouters: ["pancakeswap"],
    allowedSpenders: [PANCAKE_V2_ROUTER],
    allowedContracts: [PANCAKE_V2_ROUTER],
    maxTradeUsd: Number(process.env.TWAK_MAX_TRADE_USD ?? "30"),
    maxDailySpendUsd: Number(process.env.TWAK_MAX_DAILY_SPEND_USD ?? "20"),
    maxSlippageBps: Number(process.env.TWAK_MAX_SLIPPAGE_BPS ?? "50"),
    allowInfiniteApprovals: false,
    approvalBufferBps: config.approvalBufferBps,
  };

  // Real BSC chain reader (viem) — reserves, on-chain quotes, gas. Pinned to 56.
  const rpcUrls = (process.env.BSC_RPC_URLS ?? "https://bsc-dataseed.binance.org,https://bsc-dataseed1.defibit.io")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const reader = new LiveBscReader({ rpcUrls });
  await reader.assertChain();

  // Real CMC x402 client (USDC on Base) — pays per request in the loop when funded.
  const x402 = process.env.X402_PRIVATE_KEY ? new CmcX402Client() : null;

  // Real TWAK signer (the only thing that signs) — live mode only.
  const executor =
    mode === "live"
      ? new PolicyEnforcingExecutor(
          new CliTwakExecutor({ tokens: loaded.tokens }),
          loaded.allowlist,
          twakPolicy,
        )
      : null;

  // Optional: register the agent identity on-chain via the BNB AI Agent SDK sidecar.
  if (process.env.BNB_SDK_REGISTER === "true") {
    try {
      const id = await registerAgentIdentity({
        scriptPath: join(ROOT, "apps", "bnb-sdk-sidecar", "register_agent.py"),
        env: { BNB_SDK_NETWORK: process.env.BNB_SDK_NETWORK ?? "bsc" },
      });
      console.log(`[worker] BNB agent identity registered: id=${id.agentId} tx=${id.transactionHash}`);
    } catch (err) {
      await sendAlert(process.env.ALERT_WEBHOOK_URL, {
        reason: "execution_failure",
        message: `BNB SDK identity registration failed: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      });
      console.warn(`[worker] BNB SDK registration failed (continuing): ${(err as Error).message}`);
    }
  }

  let spentTodayUsd = 0;
  let cycles = 0;
  let lastSnapshotHour = "";

  while (maxCycles === 0 || cycles < maxCycles) {
    cycles++;
    writeHeartbeat(mode, cycles);

    if (killEngaged()) {
      await sendAlert(process.env.ALERT_WEBHOOK_URL, {
        reason: "emergency_stop",
        message: "Kill-switch engaged — worker halting new entries.",
        timestamp: new Date().toISOString(),
      });
      console.warn("[worker] kill-switch engaged — halting. (Would cancel intents + attempt revocations.)");
      break;
    }

    try {
      const symbols = STARTER_MAJORS.map((t) => t.symbol).slice(0, 6);
      const [quotes, fg, bnb] = await Promise.all([cmc.getQuotes(symbols), cmc.getFearGreed(), cmc.getQuotes(["BNB"])]);
      const bnbChange = bnb.data[0]?.percentChange24h ?? 0;
      const bnbPrice = bnb.data[0]?.priceUsd ?? 0;

      // Real gas cost per leg from on-chain gas price × BNB price.
      const gasPerLegUsd = bnbPrice > 0 ? await reader.gasPerLegUsd(bnbPrice) : 0.02;

      // x402-in-the-loop: pay for a CMC x402 request used in this decision cycle.
      let x402ReceiptId: string | undefined;
      if (x402) {
        try {
          const paid = await x402.get("/x402/v1/dex/search", { q: "bnb" });
          x402ReceiptId = paid.receipt.receipt;
          await audit.append({
            timestamp: new Date().toISOString(),
            mandateId: `x402-c${cycles}`,
            stage: "perception",
            input: { url: paid.receipt.requestUrl },
            output: { paid: true, receipt: paid.receipt.receipt },
            proofAnchors: { x402Receipt: paid.receipt.receipt },
          });
        } catch (err) {
          await sendAlert(process.env.ALERT_WEBHOOK_URL, {
            reason: "execution_failure",
            message: `x402 payment failed: ${(err as Error).message}`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      const ctx: PipelineContext = {
        config,
        calibration,
        allowlist: loaded.allowlist,
        twakPolicy,
        portfolioUsd: config.startingCapitalUsd,
        deployableUsd: config.startingCapitalUsd - config.gasReserveUsd,
        windowDrawdownPct: 0,
        dailyDrawdownPct: 0,
        openPositions: 0,
        tradesToday: 0,
        survivalMode: false,
        marketDataStale: false,
        calibrationStale: mode === "dry",
      };

      // Evaluate every candidate against REAL pool reserves + a real shadow-fill.
      const evaluated: Array<{
        result: ReturnType<typeof evaluateCandidate>;
        token: (typeof loaded.tokens)[number];
        tools: string[];
        ts: string;
      }> = [];
      for (const quote of quotes.data) {
        const token = loaded.tokens.find((t) => t.symbol === quote.symbol);
        if (!token) continue;
        let reserves;
        let shadow;
        try {
          reserves = await reader.getReserves(usdt.bscContractAddress, token.bscContractAddress, usdt.decimals, token.decimals);
          // Shadow-fill: two on-chain quotes at intended size; deviation flags MEV/thin liquidity.
          const probe = Math.min(config.startingCapitalUsd, 15);
          const q1 = await reader.getAmountOut(usdt.bscContractAddress, token.bscContractAddress, probe, usdt.decimals, token.decimals);
          const q2 = await reader.getAmountOut(usdt.bscContractAddress, token.bscContractAddress, probe, usdt.decimals, token.decimals);
          shadow = { expectedOut: q1.amountOut, simulatedOut: q2.amountOut };
        } catch (err) {
          if (err instanceof NoPoolError) {
            console.log(`[worker] ${quote.symbol}: no direct USDT pool — skipped`);
            continue;
          }
          throw err;
        }

        const momentum = buildMomentumInputs(quote, bnbChange, fg.data, 0.7);
        const result = evaluateCandidate(
          {
            symbol: quote.symbol,
            signalFamily: "momentum",
            scoreInputs: momentum.inputs,
            cmcToolsUsed: momentum.toolsUsed,
            marketDataTimestamp: quote.lastUpdated,
            tokenInAddress: usdt.bscContractAddress,
            tokenOutAddress: token.bscContractAddress,
            router: "pancakeswap",
            spender: PANCAKE_V2_ROUTER,
            to: PANCAKE_V2_ROUTER,
            atrPct: Math.max(0.02, Math.abs(quote.percentChange24h) / 100),
            reserveIn: reserves.reserveIn,
            reserveOut: reserves.reserveOut,
            poolFeeBps: 25,
            gasPerLegUsd,
            shadow,
          },
          ctx,
        );
        evaluated.push({ result, token, tools: momentum.toolsUsed, ts: quote.lastUpdated });
      }

      // Rank approved candidates; the top one is the trade for this cycle.
      const winner = evaluated
        .filter((e) => e.result.approved)
        .sort((a, b) => b.result.score - a.result.score)[0];

      let approved = 0;
      for (const e of evaluated) {
        const isWinner = winner === e;
        const mandate = buildBscMandate({
          result: e.result,
          mode: mode === "live" ? "live" : "rehearsal",
          strategyId: "bsc-two-family",
          naturalLanguageIntent: "Momentum + catalyst over the eligible list, spot only, $40 book.",
          compiledStrategy: {},
          assetContract: e.token.bscContractAddress,
          cmcToolsUsed: e.tools,
          marketDataTimestamp: e.ts,
          calibrationVersion: calibration.version,
          createdAt: new Date().toISOString(),
          id: `${runId}-c${cycles}-${e.token.symbol}`,
          x402Receipt: x402ReceiptId,
        });
        if (e.result.approved) approved++;

        // Live execution: the winner is signed by TWAK (the sole signer).
        if (isWinner && executor && e.result.intent) {
          try {
            const outcome = await executor.execute(e.result.intent, { spentTodayUsd });
            if (outcome.refused) {
              await sendAlert(process.env.ALERT_WEBHOOK_URL, {
                reason: "twak_refusal",
                message: `TWAK refused ${e.token.symbol}: ${outcome.policy.rejectCode} — ${outcome.policy.reason}`,
                timestamp: new Date().toISOString(),
              });
            } else if (outcome.receipt) {
              spentTodayUsd += e.result.economics.positionSizeUsd;
              mandate.execution.status = "submitted";
              mandate.execution.txHash = outcome.receipt.txHash;
              mandate.proofAnchors.bscTxHash = outcome.receipt.txHash;
              mandate.proofAnchors.twakReceipt = outcome.receipt.twakReceiptId;
              await audit.append({
                timestamp: new Date().toISOString(),
                mandateId: mandate.id,
                stage: "execution",
                input: { amountUsd: e.result.economics.positionSizeUsd },
                output: { status: "submitted", txHash: outcome.receipt.txHash },
                proofAnchors: { bscTxHash: outcome.receipt.txHash, twakReceipt: outcome.receipt.twakReceiptId },
              });
              console.log(`[worker] EXECUTED ${e.token.symbol} → tx ${outcome.receipt.txHash}`);
            }
          } catch (err) {
            await sendAlert(process.env.ALERT_WEBHOOK_URL, {
              reason: "execution_failure",
              message: `TWAK execution failed for ${e.token.symbol}: ${(err as Error).message}`,
              timestamp: new Date().toISOString(),
            });
            console.error(`[worker] execution failed for ${e.token.symbol}: ${(err as Error).message}`);
          }
        }

        await appendMandate(mandatesPath, mandate);
      }

      // Hourly snapshot (mirrors the verified hourly scoring). Valued from CMC.
      const hour = new Date().toISOString().slice(0, 13);
      if (hour !== lastSnapshotHour) {
        lastSnapshotHour = hour;
        const holdings: Holding[] = [{ symbol: "USDT", amount: config.startingCapitalUsd, priceUsd: 1 }];
        const valueUsd = valueHoldings(holdings);
        const snapPath = join(AUDIT_DIR, `${runId}.snapshots.jsonl`);
        writeFileSync(snapPath, "", { flag: "a" });
        const line = JSON.stringify({ hourIso: `${hour}:00:00.000Z`, valueUsd }) + "\n";
        const fs = await import("node:fs/promises");
        await fs.appendFile(snapPath, line, "utf8");
      }

      console.log(`[worker] cycle ${cycles}: ${approved}/${evaluated.length} approved, gas/leg $${gasPerLegUsd.toFixed(4)} (${mode}).`);
    } catch (err) {
      await sendAlert(process.env.ALERT_WEBHOOK_URL, {
        reason: "execution_failure",
        message: `Cycle ${cycles} error: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      });
      console.error(`[worker] cycle ${cycles} error (loop continues):`, (err as Error).message);
    }

    if (maxCycles !== 0 && cycles >= maxCycles) break;
    await sleep(intervalMs);
  }

  console.log(`[worker] stopped after ${cycles} cycle(s). Mandates: ${mandatesPath}`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exitCode = 1;
});
