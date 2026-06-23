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

import "dotenv/config"; // load .env so the backtest uses the live agent's thresholds
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BitgetPublicMarketData,
  XSTOCK_UNIVERSE,
  backtestReactor,
  reactorBacktestConfigFromEnv,
  type BitgetCandle,
} from "@wardenclaw/bitget-adapter";

async function main(): Promise<void> {
  const requested = process.argv.slice(2).find((arg) => arg !== "--") ?? "NVDAx";
  const known = XSTOCK_UNIVERSE.find(
    (item) =>
      item.display.toLowerCase() === requested.toLowerCase() ||
      item.underlying.toLowerCase() === requested.toLowerCase() ||
      item.bitgetSymbol.toLowerCase() === requested.toLowerCase(),
  );
  const symbol = known?.bitgetSymbol ?? requested.toUpperCase();
  // Treat blank env vars as unset (dotenv loads `KEY=` as ""), so they fall back
  // to defaults rather than sending an empty base URL / granularity to Bitget.
  const envOr = (v: string | undefined, fallback: string): string => {
    const t = (v ?? "").trim();
    return t === "" ? fallback : t;
  };
  // Default to a wider window than the live poll so shocks have room to appear;
  // Bitget's spot candles endpoint caps a single request at 1000 bars.
  const barLimit = Math.min(
    1000,
    Math.max(2, Number(process.env.BITGET_BACKTEST_BARS ?? 1000) || 1000),
  );
  const baseUrl = envOr(process.env.BITGET_PUBLIC_BASE_URL, "https://api.bitget.com");
  const md = new BitgetPublicMarketData({ baseUrl });
  const candles: BitgetCandle[] = await md.getCandles(
    symbol,
    envOr(process.env.BITGET_CANDLE_GRANULARITY, "5min"),
    barLimit,
  );
  if (candles.length < 2) throw new Error(`Bitget returned insufficient candles for ${symbol}`);
  const source = `bitget_public:${symbol}`;

  // Use the SAME thresholds the live paper agent runs on, so the backtest
  // reflects deployed behavior rather than the stricter hard-coded defaults.
  const cfg = reactorBacktestConfigFromEnv();
  const result = backtestReactor(candles, cfg);
  const report = {
    source,
    generatedAt: new Date().toISOString(),
    bars: candles.length,
    thresholds: {
      shockWindowBars: cfg.reactor.shock.windowBars,
      shockMinMagnitudePct: cfg.reactor.shock.minMagnitudePct,
      shockMinVolumeRatio: cfg.reactor.shock.minVolumeRatio,
      cooldownBars: cfg.reactor.cooldownBars,
      netEdgeMinBps: cfg.netEdgeMinBps,
    },
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
