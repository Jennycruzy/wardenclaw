/**
 * Backfill the skip-funnel rejection codes into pre-existing calibrated backtest
 * reports (data/backtests/bitget_history:*) that were generated before the
 * reactor recorded them. Bitget history-candles are immutable, and each report
 * stores its full per-bar equityCurve, so we can re-fetch the EXACT window the
 * report covered, recompute it with the same config, and — only when the trade
 * count and net PnL reproduce identically — patch in the recomputed `rejections`
 * field. Everything else (summary, trades, equityCurve) is left byte-identical,
 * so a profitable headline run keeps its PnL.
 *
 *   pnpm tsx scripts/backfill-backtest-rejections.ts            # dry run, all
 *   pnpm tsx scripts/backfill-backtest-rejections.ts TSLAx      # dry run, filter
 *   pnpm tsx scripts/backfill-backtest-rejections.ts TSLAx --write
 */
import "dotenv/config";

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  backtestReactor,
  DEFAULT_REACTOR_BACKTEST_CONFIG,
  DEFAULT_REACTOR_CONFIG,
  type BitgetCandle,
  type ReactorBacktestConfig,
} from "@wardenclaw/bitget-adapter";

const BASE = process.env.BITGET_PUBLIC_BASE_URL ?? "https://api.bitget.com";
const GRANULARITY = "5min";
const BAR_MS = 5 * 60_000;
const CALIBRATION_VOLUME_RATIO = 1.5; // the fixed ratio the sweep used

/** Page history-candles backwards from `endMs` until `sinceMs` (real data only). */
async function fetchHistory(symbol: string, sinceMs: number, endMs: number): Promise<BitgetCandle[]> {
  const byTime = new Map<number, BitgetCandle>();
  // Bitget's endTime is exclusive, so start one bar past the window's last bar
  // to make sure that final bar is included; the ts<=endMs filter trims the rest.
  let endTime = endMs + BAR_MS;
  for (let page = 0; page < 120; page++) {
    const url =
      `${BASE}/api/v2/spot/market/history-candles?symbol=${encodeURIComponent(symbol)}` +
      `&granularity=${GRANULARITY}&endTime=${endTime}&limit=200`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${symbol}`);
    const body = (await res.json()) as { code: string; msg: string; data?: unknown[][] };
    if (body.code !== "00000") throw new Error(`Bitget ${body.code}: ${body.msg}`);
    const rows = body.data ?? [];
    if (rows.length === 0) break;
    let oldest = endTime;
    for (const r of rows) {
      const ts = Number(r[0]);
      oldest = Math.min(oldest, ts);
      byTime.set(ts, {
        time: new Date(ts).toISOString(),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      });
    }
    if (oldest <= sinceMs || rows.length < 200) break;
    endTime = oldest - BAR_MS;
  }
  return [...byTime.entries()]
    .filter(([ts]) => ts >= sinceMs && ts <= endMs)
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c);
}

/** Reconstruct the calibration config encoded in a report's source string. */
function configFromSource(source: string): ReactorBacktestConfig {
  const params = source.split(":")[2] ?? "";
  const mag = Number(/mag([\d.]+)/.exec(params)?.[1] ?? DEFAULT_REACTOR_CONFIG.shock.minMagnitudePct);
  const vol = Number(/vol([\d.]+)/.exec(params)?.[1] ?? CALIBRATION_VOLUME_RATIO);
  // `..._tp<x>_hold<y>` runs encode the exit policy in their name. `..._vol<x>`
  // runs predate the take-profit/max-hold exit (commit 47307f5) and closed only
  // on the volatility stop, so disable the signal exits to match that behaviour.
  const tpMatch = /tp([\d.]+)/.exec(params);
  const tp = tpMatch ? Number(tpMatch[1]) : Number.POSITIVE_INFINITY;
  const hold = tpMatch ? Number(/hold(\d+)/.exec(params)?.[1] ?? DEFAULT_REACTOR_CONFIG.maxHoldBars) : Number.POSITIVE_INFINITY;
  return {
    ...DEFAULT_REACTOR_BACKTEST_CONFIG,
    reactor: {
      ...DEFAULT_REACTOR_CONFIG,
      shock: { ...DEFAULT_REACTOR_CONFIG.shock, minMagnitudePct: mag, minVolumeRatio: vol },
      takeProfitPct: tp,
      maxHoldBars: hold,
    },
  };
}

interface Report {
  source: string;
  bars: number;
  summary: { numTrades: number; pnlUsd: number };
  rejections: Record<string, number>;
  equityCurve: Array<{ time: string; equityUsd: number }>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const write = args.includes("--write");
  const filter = args.find((a) => !a.startsWith("--"));
  const dir = join(process.cwd(), "data", "backtests");

  // Display ticker -> bitget symbol, so we know which market to re-fetch.
  const { TRADEABLE_XSTOCKS } = await import("@wardenclaw/bitget-adapter");
  const symbolFor = (display: string): string | undefined =>
    TRADEABLE_XSTOCKS.find((s) => s.display === display)?.bitgetSymbol;

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let patched = 0;
  let skipped = 0;
  for (const file of files) {
    const path = join(dir, file);
    let report: Report;
    try {
      report = JSON.parse(readFileSync(path, "utf8")) as Report;
    } catch {
      continue;
    }
    if (!report.source?.startsWith("bitget_history:")) continue;
    if (filter && !report.source.includes(filter)) continue;
    if (Object.keys(report.rejections ?? {}).length > 0) {
      console.log(`= ${report.source} already has rejections — skipping`);
      continue;
    }
    const display = report.source.split(":")[1]!;
    const symbol = symbolFor(display);
    const ec = report.equityCurve ?? [];
    if (!symbol || ec.length === 0) {
      console.warn(`! ${report.source}: missing symbol or equityCurve — skipping`);
      skipped++;
      continue;
    }
    const firstMs = Date.parse(ec[0]!.time);
    const lastMs = Date.parse(ec[ec.length - 1]!.time);
    const candles = await fetchHistory(symbol, firstMs, lastMs);
    const cfg = configFromSource(report.source);
    const r = backtestReactor(candles, cfg);
    const pnlMatch = Number(r.pnlUsd.toFixed(2)) === report.summary.pnlUsd;
    const tradesMatch = r.numTrades === report.summary.numTrades;
    const barsMatch = candles.length === report.bars;
    if (!pnlMatch || !tradesMatch || !barsMatch) {
      console.warn(
        `! ${report.source}: NOT reproduced (bars ${candles.length}/${report.bars}, ` +
          `trades ${r.numTrades}/${report.summary.numTrades}, ` +
          `pnl ${r.pnlUsd.toFixed(2)}/${report.summary.pnlUsd}) — left untouched`,
      );
      skipped++;
      continue;
    }
    console.log(
      `✓ ${report.source}: reproduced (${r.numTrades} trades, pnl ${report.summary.pnlUsd}) ` +
        `→ rejections ${JSON.stringify(r.rejections)}`,
    );
    if (write) {
      report.rejections = r.rejections; // patch ONLY this field
      writeFileSync(path, JSON.stringify(report, null, 2));
      patched++;
    }
  }
  console.log(
    `\n[backfill] ${write ? "patched" : "would patch"} ${patched || (write ? 0 : "(dry run)")} report(s), ` +
      `${skipped} skipped. ${write ? "" : "Re-run with --write to apply."}`,
  );
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exitCode = 1;
});
