/**
 * Backtest the RUNECLAW Stocks reactor over real Bitget historical candles and
 * write a PnL/drawdown report to data/backtests/. Runs the same shock/cooldown
 * and net-edge logic the live paper agent uses.
 *
 *   pnpm backtest:bitget -- NVDAXUSDT
 *
 * Falls back to a documented synthetic shock-and-run series when no symbol is
 * given or live data is unavailable — clearly labeled as synthetic in the report.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BitgetPublicMarketData,
  backtestReactor,
  type BitgetCandle,
} from "@runeclaw/bitget-adapter";

function syntheticSeries(): BitgetCandle[] {
  const bars: BitgetCandle[] = [];
  let price = 100;
  for (let i = 0; i < 60; i++) {
    // Inject a shock at bar 20, then a sustained run-up.
    const isShock = i === 20;
    const drift = i > 20 ? 0.012 : 0.0;
    price = isShock ? price * 1.06 : price * (1 + drift);
    bars.push({
      time: new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString(),
      open: price * 0.999,
      high: price * 1.004,
      low: price * 0.996,
      close: price,
      volume: isShock ? 3000 : 1000,
    });
  }
  return bars;
}

async function main(): Promise<void> {
  const symbol = process.argv[2];
  let candles: BitgetCandle[];
  let source: string;

  if (symbol) {
    try {
      const md = new BitgetPublicMarketData({ baseUrl: process.env.BITGET_PUBLIC_BASE_URL });
      candles = await md.getCandles(symbol, process.env.BITGET_CANDLE_GRANULARITY ?? "5min", 200);
      source = `bitget_public:${symbol}`;
    } catch (err) {
      console.warn(`[backtest] live data unavailable (${(err as Error).message}); using synthetic series`);
      candles = syntheticSeries();
      source = "synthetic_shock_and_run";
    }
  } else {
    candles = syntheticSeries();
    source = "synthetic_shock_and_run";
  }

  const result = backtestReactor(candles);
  const report = {
    source,
    generatedAt: new Date().toISOString(),
    bars: candles.length,
    summary: {
      numTrades: result.numTrades,
      pnlUsd: Number(result.pnlUsd.toFixed(2)),
      totalReturnPct: Number(result.totalReturnPct.toFixed(2)),
      maxDrawdownPct: Number(result.maxDrawdownPct.toFixed(2)),
      winRate: Number((result.winRate * 100).toFixed(1)),
    },
    rejections: result.rejections,
    trades: result.trades,
  };

  const dir = join(process.cwd(), "data", "backtests");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `bitget-${source.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(`[backtest] source: ${source}`);
  console.log(`[backtest] trades=${report.summary.numTrades} return=${report.summary.totalReturnPct}% ` +
    `maxDD=${report.summary.maxDrawdownPct}% winRate=${report.summary.winRate}%`);
  console.log(`[backtest] report: ${out}`);
}

main().catch((err) => {
  console.error("[backtest] fatal:", err);
  process.exitCode = 1;
});
