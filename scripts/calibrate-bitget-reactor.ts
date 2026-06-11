/**
 * Calibrate the reactor's shock thresholds against REAL Bitget history.
 *
 * Pages /api/v2/spot/market/history-candles back BITGET_CALIBRATION_DAYS
 * (default 14) days of 5-minute candles for every tradeable xStock, then runs
 * the shared reactor backtest (same first-spike rejection, cooldown, net-edge
 * filter as the live agent) across a grid of (minMagnitudePct, minVolumeRatio)
 * combinations. Prints the sweep table, recommends a config, and writes:
 *   - data/calibration/bitget-reactor-sweep.json   (full sweep)
 *   - data/backtests/bitget-calibrated-*.json      (dashboard-shaped reports
 *     for the recommended config, one per symbol)
 *
 *   pnpm tsx scripts/calibrate-bitget-reactor.ts
 */
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  backtestReactor,
  DEFAULT_REACTOR_BACKTEST_CONFIG,
  DEFAULT_REACTOR_CONFIG,
  TRADEABLE_XSTOCKS,
  type BitgetCandle,
  type ReactorBacktestConfig,
} from "@wardenclaw/bitget-adapter";

const BASE = process.env.BITGET_PUBLIC_BASE_URL ?? "https://api.bitget.com";
const DAYS = Number(process.env.BITGET_CALIBRATION_DAYS ?? 14);
const GRANULARITY = "5min";
const BAR_MS = 5 * 60_000;

const MAGNITUDES = [0.03, 0.02, 0.015, 0.012, 0.01];
// Volume ratio barely moved results in the first sweep (thin baseline volume
// makes shock bars clear any ratio); fix it and sweep the exit policy instead.
const VOLUME_RATIO = 1.5;
const TAKE_PROFITS = [0.01, 0.015, 0.02, 0.03];
const MAX_HOLDS = [12, 24, 48, 96];

/** Page history-candles backwards from now until `sinceMs` (real data only). */
async function fetchHistory(symbol: string, sinceMs: number): Promise<BitgetCandle[]> {
  const byTime = new Map<number, BitgetCandle>();
  let endTime = Date.now();
  for (let page = 0; page < 80; page++) {
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
    .filter(([ts]) => ts >= sinceMs)
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c);
}

interface SweepRow {
  minMagnitudePct: number;
  takeProfitPct: number;
  maxHoldBars: number;
  trades: number;
  tradesPerDay: number;
  pnlUsd: number;
  returnPct: number;
  winRatePct: number;
  worstMaxDrawdownPct: number;
  perSymbol: Record<string, { trades: number; pnlUsd: number }>;
}

function configFor(minMagnitudePct: number, takeProfitPct: number, maxHoldBars: number): ReactorBacktestConfig {
  return {
    ...DEFAULT_REACTOR_BACKTEST_CONFIG,
    reactor: {
      ...DEFAULT_REACTOR_CONFIG,
      shock: { ...DEFAULT_REACTOR_CONFIG.shock, minMagnitudePct, minVolumeRatio: VOLUME_RATIO },
      takeProfitPct,
      maxHoldBars,
    },
  };
}

async function main(): Promise<void> {
  const sinceMs = Date.now() - DAYS * 86_400_000;
  const histories = new Map<string, BitgetCandle[]>();
  for (const sym of TRADEABLE_XSTOCKS) {
    const candles = await fetchHistory(sym.bitgetSymbol, sinceMs);
    histories.set(sym.display, candles);
    const from = candles[0]?.time ?? "n/a";
    console.log(`[calibrate] ${sym.display} (${sym.bitgetSymbol}): ${candles.length} bars from ${from}`);
  }
  const actualDays = Math.max(
    ...[...histories.values()].map((c) => (c.length * BAR_MS) / 86_400_000),
  );

  const rows: SweepRow[] = [];
  for (const mag of MAGNITUDES) {
    for (const tp of TAKE_PROFITS) {
    for (const hold of MAX_HOLDS) {
      const cfg = configFor(mag, tp, hold);
      let trades = 0;
      let pnlUsd = 0;
      let wins = 0;
      let worstDD = 0;
      const perSymbol: SweepRow["perSymbol"] = {};
      for (const [display, candles] of histories) {
        if (candles.length < 50) continue;
        const r = backtestReactor(candles, cfg);
        trades += r.numTrades;
        pnlUsd += r.pnlUsd;
        wins += Math.round(r.winRate * r.numTrades);
        worstDD = Math.max(worstDD, r.maxDrawdownPct);
        perSymbol[display] = { trades: r.numTrades, pnlUsd: Number(r.pnlUsd.toFixed(2)) };
      }
      rows.push({
        minMagnitudePct: mag,
        takeProfitPct: tp,
        maxHoldBars: hold,
        trades,
        tradesPerDay: Number((trades / actualDays).toFixed(2)),
        pnlUsd: Number(pnlUsd.toFixed(2)),
        returnPct: Number(((pnlUsd / DEFAULT_REACTOR_BACKTEST_CONFIG.startingCapitalUsd) * 100).toFixed(2)),
        winRatePct: trades > 0 ? Number(((wins / trades) * 100).toFixed(1)) : 0,
        worstMaxDrawdownPct: Number(worstDD.toFixed(2)),
        perSymbol,
      });
    }
    }
  }

  console.log(`\n[calibrate] sweep over ~${actualDays.toFixed(1)} days, ${histories.size} symbols:`);
  console.log("  mag%    tp%   hold   trades  /day   pnl$      ret%    win%   worstDD%");
  for (const r of rows) {
    console.log(
      `  ${(r.minMagnitudePct * 100).toFixed(1).padStart(4)}  ${(r.takeProfitPct * 100).toFixed(1).padStart(5)}  ${String(r.maxHoldBars).padStart(5)}  ` +
        `${String(r.trades).padStart(6)}  ${String(r.tradesPerDay).padStart(5)}  ${String(r.pnlUsd).padStart(8)}  ` +
        `${String(r.returnPct).padStart(6)}  ${String(r.winRatePct).padStart(5)}  ${String(r.worstMaxDrawdownPct).padStart(7)}`,
    );
  }

  // Recommend: PROFITABLE first — a selective config that trades once a week
  // and wins beats an active one that bleeds. Among profitable configs prefer
  // the most active (more demo evidence), then shallowest drawdown. Only when
  // nothing is profitable fall back to the least-negative config inside a sane
  // activity band (0.5–4 trades/day), so the live demo still shows discipline.
  const profitable = rows.filter((r) => r.trades > 0 && r.pnlUsd > 0);
  let pool: SweepRow[];
  if (profitable.length > 0) {
    pool = profitable.sort(
      (a, b) => b.tradesPerDay - a.tradesPerDay || b.pnlUsd - a.pnlUsd || a.worstMaxDrawdownPct - b.worstMaxDrawdownPct,
    );
  } else {
    const eligible = rows.filter((r) => r.tradesPerDay >= 0.5 && r.tradesPerDay <= 4);
    pool = (eligible.length > 0 ? eligible : rows.filter((r) => r.trades > 0)).sort(
      (a, b) => b.pnlUsd - a.pnlUsd || a.worstMaxDrawdownPct - b.worstMaxDrawdownPct,
    );
    console.warn(
      "\n[calibrate] WARNING: no profitable config in this window — recommending the " +
        "least-negative active config. Consider widening BITGET_CALIBRATION_DAYS or " +
        "keeping the agent in watch-only until conditions improve.",
    );
  }
  const best = pool[0];
  if (!best) {
    console.error("\n[calibrate] no config produced a single trade — market too quiet even at 1%.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n[calibrate] RECOMMENDED: BITGET_SHOCK_MIN_MAGNITUDE_PCT=${best.minMagnitudePct} ` +
      `BITGET_SHOCK_MIN_VOLUME_RATIO=${VOLUME_RATIO} ` +
      `BITGET_TAKE_PROFIT_PCT=${best.takeProfitPct} BITGET_MAX_HOLD_BARS=${best.maxHoldBars} ` +
      `(${best.trades} trades ≈ ${best.tradesPerDay}/day, pnl $${best.pnlUsd}, ` +
      `win ${best.winRatePct}%, worst DD ${best.worstMaxDrawdownPct}%)`,
  );

  const calDir = join(process.cwd(), "data", "calibration");
  mkdirSync(calDir, { recursive: true });
  writeFileSync(
    join(calDir, "bitget-reactor-sweep.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), days: actualDays, granularity: GRANULARITY, rows, recommended: best }, null, 2),
  );

  // Dashboard-shaped backtest reports for the recommended config.
  const btDir = join(process.cwd(), "data", "backtests");
  mkdirSync(btDir, { recursive: true });
  const cfg = configFor(best.minMagnitudePct, best.takeProfitPct, best.maxHoldBars);
  for (const [display, candles] of histories) {
    if (candles.length < 50) continue;
    const r = backtestReactor(candles, cfg);
    const report = {
      source: `bitget_history:${display}:calibrated_mag${best.minMagnitudePct}_tp${best.takeProfitPct}_hold${best.maxHoldBars}`,
      generatedAt: new Date().toISOString(),
      bars: candles.length,
      summary: {
        numTrades: r.numTrades,
        pnlUsd: Number(r.pnlUsd.toFixed(2)),
        totalReturnPct: Number(r.totalReturnPct.toFixed(2)),
        maxDrawdownPct: Number(r.maxDrawdownPct.toFixed(2)),
        winRate: Number((r.winRate * 100).toFixed(1)),
      },
      rejections: r.rejections,
      trades: r.trades,
      equityCurve: r.equityCurve.map((p) => ({ time: p.time, equityUsd: Number(p.equityUsd.toFixed(2)) })),
    };
    writeFileSync(
      join(btDir, `bitget-calibrated-${display}-${Date.now()}.json`),
      JSON.stringify(report, null, 2),
    );
  }
  console.log(`[calibrate] sweep: data/calibration/bitget-reactor-sweep.json`);
  console.log(`[calibrate] dashboard reports: data/backtests/bitget-calibrated-*.json`);
}

main().catch((err) => {
  console.error("[calibrate] fatal:", err);
  process.exitCode = 1;
});
