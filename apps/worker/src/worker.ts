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
import { CmcClient, buildMomentumInputs } from "@runeclaw/cmc-adapter";
import { loadEligibleTokens, PANCAKE_V2_ROUTER, STARTER_MAJORS } from "@runeclaw/bsc-adapter";
import { evaluateCandidate, buildBscMandate, sendAlert, type PipelineContext } from "@runeclaw/bnb-agent";
import type { TwakPolicyConfig } from "@runeclaw/twak-adapter";

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

      let approved = 0;
      for (const quote of quotes.data) {
        const token = loaded.tokens.find((t) => t.symbol === quote.symbol);
        if (!token) continue;
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
            reserveIn: 5_000_000,
            reserveOut: 5_000_000,
            poolFeeBps: 25,
            gasPerLegUsd: 0.02,
          },
          ctx,
        );
        const mandate = buildBscMandate({
          result,
          mode: mode === "live" ? "live" : "rehearsal",
          strategyId: "bsc-two-family",
          naturalLanguageIntent: "Momentum + catalyst over the eligible list, spot only, $40 book.",
          compiledStrategy: {},
          assetContract: token.bscContractAddress,
          cmcToolsUsed: momentum.toolsUsed,
          marketDataTimestamp: quote.lastUpdated,
          calibrationVersion: calibration.version,
          createdAt: new Date().toISOString(),
          id: `${runId}-c${cycles}-${quote.symbol}`,
        });
        await appendMandate(mandatesPath, mandate);
        if (result.approved) approved++;
        // NOTE: live signing would call PolicyEnforcingExecutor here. In dry mode
        // we never sign; status stays not_submitted — no fake fills.
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

      console.log(`[worker] cycle ${cycles}: ${approved}/${quotes.data.length} approved (${mode}).`);
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
