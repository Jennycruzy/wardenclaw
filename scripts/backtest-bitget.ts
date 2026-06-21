/**
 * Backtest the WARDENCLAW Stocks reactor over real Bitget historical candles and
 * write a PnL/drawdown report to data/backtests/. Runs the same shock/cooldown
 * and net-edge logic the live paper agent uses.
 *
 *   pnpm backtest:bitget -- NVDAXUSDT
 *
 * Requires real Bitget candles. Data errors fail the run rather than silently
 * replacing the requested market with a synthetic series.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BitgetPublicMarketData,
  backtestReactor,
  type BitgetCandle,
} from "@wardenclaw/bitget-adapter";

async function main(): Promise<void> {
  const symbol = process.argv[2] ?? "NVDAXUSDT";
  const md = new BitgetPublicMarketData({ baseUrl: process.env.BITGET_PUBLIC_BASE_URL });
  const candles: BitgetCandle[] = await md.getCandles(
    symbol,
    process.env.BITGET_CANDLE_GRANULARITY ?? "5min",
    200,
  );
  if (candles.length < 2) throw new Error(`Bitget returned insufficient candles for ${symbol}`);
  const source = `bitget_public:${symbol}`;

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
    equityCurve: result.equityCurve.map((p) => ({
      time: p.time,
      equityUsd: Number(p.equityUsd.toFixed(2)),
    })),
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
