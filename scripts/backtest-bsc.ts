/**
 * Backtest the BSC momentum strategy over a price series, running the SAME
 * economics the live agent uses — friction (gas + slippage + LP fee + simulated
 * scoring cost), the net-edge gate, and volatility-stop coherence — so results
 * reflect the actual scored economics on a $40 book. Writes a report to
 * data/backtests/. Uses a documented synthetic series when no real series is fed.
 *
 *   pnpm backtest:bsc
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runBacktest, loadRiskConfig, type Bar } from "@runeclaw/core";

const config = loadRiskConfig(process.env as Record<string, string | undefined>);

/** A synthetic regime: chop, then a sustained momentum run, then a pullback. */
function syntheticBars(): Bar[] {
  const bars: Bar[] = [];
  let price = 1.0;
  for (let i = 0; i < 80; i++) {
    const phase = i < 20 ? 0 : i < 55 ? 0.012 : -0.006;
    const wiggle = ((i % 5) - 2) * 0.001;
    price = price * (1 + phase + wiggle);
    bars.push({ time: new Date(Date.UTC(2026, 5, 1, i)).toISOString(), price, atrPct: 0.03 });
  }
  return bars;
}

function main(): void {
  const bars = syntheticBars();

  // Momentum signal: enter when price is above its short trailing average.
  const signalFn = (bar: Bar, index: number, hasPosition: boolean) => {
    if (hasPosition || index < 6) return null;
    const window = bars.slice(index - 5, index + 1);
    const sma = window.reduce((s, b) => s + b.price, 0) / window.length;
    if (bar.price > sma * 1.004) {
      return { score: 82, expectedMoveBps: 300 };
    }
    return null;
  };

  const result = runBacktest(bars, signalFn, {
    startingCapitalUsd: config.startingCapitalUsd,
    perTradeRiskPct: config.perTradeRiskPct,
    stopAtrMultiple: config.stopAtrMultiple,
    maxPositionPct: config.maxPositionPct,
    netEdgeMinBps: config.netEdgeMinBps,
    frictionBudgetBps: config.frictionBudgetBps,
    scoringSimCostBps: config.scoringSimCostBps,
    gasPerLegUsd: 0.02,
    slippageBps: 8,
    lpFeeBps: 25,
    safetyBufferBps: 5,
  });

  const report = {
    source: "synthetic_regime",
    generatedAt: new Date().toISOString(),
    bars: bars.length,
    startingCapitalUsd: config.startingCapitalUsd,
    summary: {
      numTrades: result.numTrades,
      pnlUsd: Number(result.pnlUsd.toFixed(2)),
      totalReturnPct: Number(result.totalReturnPct.toFixed(2)),
      maxDrawdownPct: Number(result.maxDrawdownPct.toFixed(2)),
      winRate: Number((result.winRate * 100).toFixed(1)),
    },
    rejections: result.rejections,
    trades: result.trades,
    equityCurve: result.equityCurve.map((p) => ({ time: p.time, equityUsd: Number(p.equityUsd.toFixed(4)) })),
  };

  const dir = join(process.cwd(), "data", "backtests");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `bsc-synthetic-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(`[backtest:bsc] source: ${report.source} ($${config.startingCapitalUsd} book)`);
  console.log(`[backtest:bsc] trades=${report.summary.numTrades} return=${report.summary.totalReturnPct}% maxDD=${report.summary.maxDrawdownPct}% winRate=${report.summary.winRate}%`);
  console.log(`[backtest:bsc] rejections: ${JSON.stringify(report.rejections)}`);
  console.log(`[backtest:bsc] report: ${out}`);
}

main();
