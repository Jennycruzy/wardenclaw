/**
 * run_scorecard — the aggregate backtest evidence (no narrated numbers).
 *
 * Pushes a deterministic, seeded set of realistic historical commands (a mix of
 * sane and aggressive, seeded around earnings / news shocks / weekend premium /
 * BTC-vol scenarios) through the FULL Trade-Permit Engine, then ghost-simulates
 * the ORIGINAL command vs the Warden-adjusted order over the real forward candle
 * path. Every number is COMPUTED from the cached Bitget candles — re-runnable and
 * identical across runs.
 *
 * Writes output/scorecard.md + output/scorecard.json and prints a headline table.
 *
 *   pnpm run:scorecard
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateTradePermit,
  ghostCompare,
  type TradeIntent,
  type MarketContext,
  type SimCandle,
  type SimOrder,
  type TradeVerdict,
  type ApprovedOrder,
} from "@wardenclaw/core";

interface Series { symbol: string; candles: Array<SimCandle & { volume: number }> }
const data = JSON.parse(readFileSync(join("fixtures/market/scorecard-candles.json"), "utf8")) as {
  series: Record<string, Series>;
};
const SYMBOLS = Object.keys(data.series);
const CORRELATED = new Set(["MSTRx", "COINx"]);

/** Realized-vol percentile of a trailing window vs the whole series (0..1). */
function volPercentile(candles: SimCandle[], idx: number, win = 12): number {
  const ret = (a: SimCandle) => Math.abs((a.close - a.open) / a.open);
  const all = candles.map(ret).sort((x, y) => x - y);
  const trailing = candles.slice(Math.max(0, idx - win), idx).map(ret);
  const avg = trailing.reduce((s, v) => s + v, 0) / Math.max(1, trailing.length);
  const rank = all.filter((v) => v <= avg).length / all.length;
  return Number(rank.toFixed(3));
}

interface Scenario { tag: string; ctx: Partial<MarketContext>; aggressive: boolean }
function scenarioFor(i: number): Scenario {
  switch (i % 5) {
    case 0: return { tag: "earnings", ctx: { earningsWithinHours: 12 }, aggressive: true };
    case 1: return { tag: "news_shock", ctx: { newsShockAgeMin: 4, confirmationPresent: false }, aggressive: false };
    case 2: return { tag: "weekend_premium", ctx: { marketOpen: false }, aggressive: false };
    case 3: return { tag: "btc_vol", ctx: { btcRealizedVolRising: true }, aggressive: true };
    default: return { tag: "normal", ctx: {}, aggressive: false };
  }
}

interface Row {
  symbol: string; scenario: string; verdict: TradeVerdict;
  origLeverage: number; origNotional: number;
  gatesFailed: string[];
  liquidatedOriginal: boolean; liquidatedWarden: boolean; liquidationAvoided: boolean;
  ddOriginalUsd: number; ddWardenUsd: number; pnlOriginalUsd: number; pnlWardenUsd: number;
}

function main(): void {
  const COUNT = 60;
  const FORWARD = 48;
  const rows: Row[] = [];
  const gateFreq: Record<string, number> = {};

  for (let i = 0; i < COUNT; i++) {
    const symbol = SYMBOLS[i % SYMBOLS.length]!;
    const series = data.series[symbol]!;
    const candles = series.candles;
    // Spread entries deterministically across the usable window.
    const entryIdx = 12 + ((i * 7) % (candles.length - FORWARD - 12));
    const entry = candles[entryIdx]!;
    const fwd = candles.slice(entryIdx, entryIdx + FORWARD);
    const sc = scenarioFor(i);

    const leverage = sc.aggressive ? [5, 6, 8][i % 3]! : [1, 2, 2][i % 3]!;
    const notional = [150, 300, 500, 800][i % 4]!;
    const intent: TradeIntent = {
      asset: symbol, direction: "long", notionalUsd: notional, leverage,
      orderType: "market", triggerSource: i % 2 === 0 ? "human" : "ai_agent",
      rawCommand: `Long ${symbol} $${notional} ${leverage}x (${sc.tag})`,
    };

    const premium = sc.tag === "weekend_premium" ? entry.close * 1.02 : entry.close;
    const ctx: MarketContext = {
      nowIso: entry.time, knownAsset: true, btcCorrelated: CORRELATED.has(symbol),
      price: entry.close, underlyingRefPrice: sc.tag === "weekend_premium" ? entry.close / 1.02 : entry.close,
      spreadBps: 10, volPctile: volPercentile(candles, entryIdx), confirmationPresent: true,
      marketOpen: true, btcRealizedVolRising: false, feedAgeSec: 5, closeOnlyActive: false,
      ...sc.ctx, price: sc.tag === "weekend_premium" ? premium : entry.close,
    };

    const e = evaluateTradePermit(intent, ctx);
    for (const g of e.gatesFailed) gateFreq[g] = (gateFreq[g] ?? 0) + 1;

    const original: SimOrder = { side: "long", notionalUsd: notional, leverage, entryPrice: entry.close };
    // The Warden book: adjusted order for REDUCE/HEDGE, original for APPROVE, NO position otherwise.
    const ao: ApprovedOrder | undefined = e.approvedOrder;
    const wardenOrder: SimOrder | null =
      e.verdict === "APPROVE" || e.verdict === "REDUCE" || e.verdict === "HEDGE"
        ? { side: "long", notionalUsd: ao?.notionalUsd ?? notional, leverage: ao?.leverage ?? leverage, entryPrice: entry.close }
        : null;

    const cmp = ghostCompare(original, wardenOrder ?? { ...original, notionalUsd: 0, leverage: 1 }, fwd);
    const wardenActive = wardenOrder !== null;

    rows.push({
      symbol, scenario: sc.tag, verdict: e.verdict, origLeverage: leverage, origNotional: notional,
      gatesFailed: e.gatesFailed,
      liquidatedOriginal: cmp.original.liquidated,
      liquidatedWarden: wardenActive ? cmp.wardenAdjusted.liquidated : false,
      liquidationAvoided: cmp.original.liquidated && (!wardenActive || !cmp.wardenAdjusted.liquidated),
      ddOriginalUsd: Number((cmp.original.maxDrawdownPct * notional).toFixed(2)),
      ddWardenUsd: wardenActive ? Number((cmp.wardenAdjusted.maxDrawdownPct * (wardenOrder!.notionalUsd)).toFixed(2)) : 0,
      pnlOriginalUsd: cmp.original.finalPnlUsd,
      pnlWardenUsd: wardenActive ? cmp.wardenAdjusted.finalPnlUsd : 0,
    });
  }

  const dist: Record<string, number> = {};
  for (const r of rows) dist[r.verdict] = (dist[r.verdict] ?? 0) + 1;
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  const ddOriginal = Number(sum((r) => r.ddOriginalUsd).toFixed(2));
  const ddWarden = Number(sum((r) => r.ddWardenUsd).toFixed(2));
  const liqOriginal = rows.filter((r) => r.liquidatedOriginal).length;
  const liqWarden = rows.filter((r) => r.liquidatedWarden).length;
  const liqAvoided = rows.filter((r) => r.liquidationAvoided).length;
  const pnlOriginal = Number(sum((r) => r.pnlOriginalUsd).toFixed(2));
  const pnlWarden = Number(sum((r) => r.pnlWardenUsd).toFixed(2));

  const summary = {
    commands: rows.length, forwardCandles: FORWARD,
    verdictDistribution: dist,
    aggregateMaxDrawdownUsd: { without: ddOriginal, with: ddWarden },
    liquidations: { without: liqOriginal, with: liqWarden, avoided: liqAvoided },
    aggregatePnlUsd: { without: pnlOriginal, with: pnlWarden },
    perGateTriggerFrequency: gateFreq,
  };

  mkdirSync("output", { recursive: true });
  writeFileSync(join("output/scorecard.json"), JSON.stringify({ summary, rows }, null, 2));

  const pct = (v: number) => `${((v / rows.length) * 100).toFixed(0)}%`;
  const md = [
    "# WardenClaw Scorecard (computed from real Bitget candles)",
    "",
    `Commands: **${rows.length}**, forward window: ${FORWARD} candles. Paper/sim only. Reproducible from \`fixtures/market/scorecard-candles.json\`.`,
    "",
    "## Verdict distribution",
    "",
    "| Verdict | Count | Share |",
    "|---|---|---|",
    ...["APPROVE", "REDUCE", "DELAY", "HEDGE", "BLOCK", "CLOSE_ONLY"].map((v) => `| ${v} | ${dist[v] ?? 0} | ${pct(dist[v] ?? 0)} |`),
    "",
    "## Survival impact",
    "",
    "| Metric | Without WardenClaw | With WardenClaw |",
    "|---|---|---|",
    `| Aggregate max drawdown (USD) | ${ddOriginal} | ${ddWarden} |`,
    `| Liquidations | ${liqOriginal} | ${liqWarden} |`,
    `| Aggregate PnL (USD) | ${pnlOriginal} | ${pnlWarden} |`,
    `| Liquidations avoided | — | ${liqAvoided} |`,
    "",
    "## Per-gate trigger frequency",
    "",
    "| Gate | Triggers |",
    "|---|---|",
    ...Object.entries(gateFreq).sort((a, b) => b[1] - a[1]).map(([g, n]) => `| ${g} | ${n} |`),
    "",
  ].join("\n");
  writeFileSync(join("output/scorecard.md"), md);

  // Headline table to the terminal.
  console.log("\n==================== WARDENCLAW SCORECARD ====================");
  console.log(`  ${rows.length} commands · ${FORWARD}-candle forward · PAPER/SIM · computed from real candles`);
  console.log("  Verdicts: " + ["APPROVE", "REDUCE", "DELAY", "HEDGE", "BLOCK", "CLOSE_ONLY"].map((v) => `${v} ${dist[v] ?? 0}`).join(" · "));
  console.log("  -----------------------------------------------------------");
  console.log(`  Aggregate max drawdown   without ${ddOriginal}   →  with ${ddWarden}`);
  console.log(`  Liquidations             without ${liqOriginal}   →  with ${liqWarden}   (avoided ${liqAvoided})`);
  console.log(`  Aggregate PnL            without ${pnlOriginal}   →  with ${pnlWarden}`);
  console.log("  -----------------------------------------------------------");
  console.log("  Wrote output/scorecard.md and output/scorecard.json");
  console.log("=============================================================\n");
}

main();
