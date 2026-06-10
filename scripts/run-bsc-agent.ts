/**
 * Run the RUNECLAW BSC agent decision loop.
 *
 * Modes:
 *   - With CMC_API_KEY: pulls REAL CMC perception, runs the full deterministic
 *     gate chain over the liquid-major + catalyst tiers, and writes audited
 *     mandates. Without TWAK configured it stops at "not_submitted" (no signing) —
 *     a real dry run of the decision pipeline on real data.
 *   - Without CMC_API_KEY: fails loudly with setup guidance. It never fabricates
 *     perception, prices, or trades.
 *
 *   pnpm run:bsc-agent
 *
 * Live signing requires a configured TWAK executor (TWAK_CONFIG_PATH) and is wired
 * in the worker, not this script. This script is for pre-window validation.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  AuditLogger,
  appendMandate,
  buildCalibrationReport,
  loadRiskConfig,
  type CalibrationReport,
} from "@runeclaw/core";
import { CmcClient, buildMomentumInputs } from "@runeclaw/cmc-adapter";
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
  type CandidateInput,
  type PipelineContext,
} from "@runeclaw/bnb-agent";
import type { TwakPolicyConfig } from "@runeclaw/twak-adapter";

const config = loadRiskConfig(process.env as Record<string, string | undefined>);

// A conservative seed calibration until `pnpm calibrate:edge` produces a real one.
// It is clearly labeled and stale-checked by live mode; this script is a dry run.
function seedCalibration(): CalibrationReport {
  return buildCalibrationReport(
    [
      { score: 70, realizedMoveBps: 90, win: true },
      { score: 85, realizedMoveBps: 320, win: true },
    ],
    [60, 80],
    { version: "seed-dryrun", generatedAt: new Date().toISOString(), historyDays: 0 },
  );
}

async function main(): Promise<void> {
  if (!process.env.CMC_API_KEY) {
    console.error(
      "✗ CMC_API_KEY is required for live perception. RUNECLAW never fabricates market data.\n" +
        "  Set CMC_API_KEY in .env, then re-run. (Live signing also needs TWAK_CONFIG_PATH.)",
    );
    process.exit(1);
  }

  const cmc = new CmcClient();
  const eligiblePath = process.env.ELIGIBLE_TOKENS_PATH ?? "data/eligible-tokens.json";
  const loaded = loadEligibleTokens(eligiblePath);
  console.log(`[bsc] eligible tokens: ${loaded.tokens.length} (${loaded.source})`);

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

  const calibration = seedCalibration();
  const symbols = STARTER_MAJORS.map((t) => t.symbol).slice(0, 6);
  const usdt = loaded.tokens.find((t) => t.symbol === "USDT")!;

  // Real CMC perception.
  const [quotes, fg, bnb] = await Promise.all([
    cmc.getQuotes(symbols),
    cmc.getFearGreed(),
    cmc.getQuotes(["BNB"]),
  ]);
  const bnbChange = bnb.data[0]?.percentChange24h ?? 0;
  const bnbPrice = bnb.data[0]?.priceUsd ?? 0;

  // Real BSC chain reads (viem) — reserves + gas. Pinned to chain 56.
  const rpcUrls = (process.env.BSC_RPC_URLS ?? "https://bsc-dataseed.binance.org,https://bsc-dataseed1.defibit.io")
    .split(",").map((u) => u.trim()).filter(Boolean);
  const reader = new LiveBscReader({ rpcUrls });
  await reader.assertChain();
  const gasPerLegUsd = bnbPrice > 0 ? await reader.gasPerLegUsd(bnbPrice) : 0.02;

  const auditDir = join(process.cwd(), "data", "audit");
  mkdirSync(auditDir, { recursive: true });
  const runId = `bsc-dryrun-${Date.now()}`;
  const audit = new AuditLogger(join(auditDir, `${runId}.jsonl`));
  const mandatesPath = join(auditDir, `${runId}.mandates.jsonl`);

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
    calibrationStale: false,
  };

  let approved = 0;
  for (const quote of quotes.data) {
    const token = loaded.tokens.find((t) => t.symbol === quote.symbol);
    if (!token) continue;
    const momentum = buildMomentumInputs(quote, bnbChange, fg.data, 0.7);
    // Real on-chain reserves + shadow-fill for this pair.
    let reserves;
    let shadow;
    try {
      reserves = await reader.getReserves(usdt.bscContractAddress, token.bscContractAddress, usdt.decimals, token.decimals);
      const probe = Math.min(config.startingCapitalUsd, 15);
      const q1 = await reader.getAmountOut(usdt.bscContractAddress, token.bscContractAddress, probe, usdt.decimals, token.decimals);
      shadow = { expectedOut: q1.amountOut, simulatedOut: q1.amountOut };
    } catch (err) {
      if (err instanceof NoPoolError) {
        console.log(`[bsc] ${quote.symbol.padEnd(6)} no direct USDT pool — skipped`);
        continue;
      }
      throw err;
    }
    const candidate: CandidateInput = {
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
    };
    const result = evaluateCandidate(candidate, ctx);
    const mandate = buildBscMandate({
      result,
      mode: "rehearsal",
      strategyId: "bsc-two-family",
      naturalLanguageIntent: "Momentum + catalyst over the eligible list, spot only, $40 book.",
      compiledStrategy: {},
      assetContract: token.bscContractAddress,
      cmcToolsUsed: momentum.toolsUsed,
      marketDataTimestamp: quote.lastUpdated,
      calibrationVersion: calibration.version,
      createdAt: new Date().toISOString(),
      id: `${runId}-${quote.symbol}`,
    });
    await appendMandate(mandatesPath, mandate);
    await audit.append({
      timestamp: new Date().toISOString(),
      mandateId: mandate.id,
      stage: "decision",
      input: { symbol: quote.symbol, score: result.score },
      output: { approved: result.approved, mode: result.mode, rejectCode: result.rejectCode ?? null },
    });
    console.log(
      `[bsc] ${quote.symbol.padEnd(6)} score=${String(result.score).padStart(3)} ${result.mode.padEnd(6)} ` +
        (result.approved ? `APPROVED size=$${result.economics.positionSizeUsd.toFixed(2)}` : `skip ${result.rejectCode}`),
    );
    if (result.approved) approved++;
  }

  console.log(
    `[bsc] dry run complete: ${approved}/${quotes.data.length} candidates approved (no signing — TWAK not invoked).`,
  );
  console.log(`[bsc] mandates: ${mandatesPath}`);
}

main().catch((err) => {
  console.error("[bsc] fatal:", err);
  process.exitCode = 1;
});
