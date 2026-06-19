/**
 * Studio-parity paper records — built natively over the PaperBook, no third-party
 * studio. Produces the records a paper-trading studio would show:
 *   - NAV marks: cash + mark-to-market of open positions + realized PnL.
 *   - Open positions with unrealized P&L.
 *   - Round-trip records (paper + backtest backfills), source-tagged and filterable.
 *   - Early win-rate & profit-factor — surfaced as soon as ONE round trip closes,
 *     not at an arbitrary sample threshold.
 *
 * Every figure is computed from real fills/prices; nothing is narrated.
 */

import type { PaperBook, PaperTrade } from "./paperEngine.js";

export interface RoundTrip {
  source: "paper" | "backtest";
  asset: string;
  entryPrice: number;
  exitPrice: number;
  notionalUsd: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt: string;
  closedAt: string;
  reason: PaperTrade["reason"];
}

export interface OpenMark {
  asset: string;
  entryPrice: number;
  markPrice: number;
  quantity: number;
  notionalUsd: number;
  unrealizedUsd: number;
  unrealizedPct: number;
  openedAt: string;
}

export interface PaperPerformance {
  closedTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  /** Gross profit / gross loss. Infinity when there are wins but no losses. */
  profitFactor: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  avgWinUsd: number;
  avgLossUsd: number;
  netPnlUsd: number;
}

export interface PaperRecords {
  navUsd: number;
  cashUsd: number;
  openMarkUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  openPositions: OpenMark[];
  roundTrips: RoundTrip[];
  /** null until at least one round trip has closed. */
  performance: PaperPerformance | null;
  latestCheckAt?: string;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Compute win-rate / profit-factor from one or more closed round trips. */
export function computePerformance(trips: RoundTrip[]): PaperPerformance | null {
  if (trips.length === 0) return null;
  const wins = trips.filter((t) => t.pnlUsd > 0);
  const losses = trips.filter((t) => t.pnlUsd < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const netPnl = trips.reduce((s, t) => s + t.pnlUsd, 0);
  return {
    closedTrades: trips.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: r2((wins.length / trips.length) * 100),
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : r2(grossProfit / grossLoss),
    grossProfitUsd: r2(grossProfit),
    grossLossUsd: r2(grossLoss),
    avgWinUsd: wins.length ? r2(grossProfit / wins.length) : 0,
    avgLossUsd: losses.length ? r2(grossLoss / losses.length) : 0,
    netPnlUsd: r2(netPnl),
  };
}

function paperTripsFrom(book: PaperBook): RoundTrip[] {
  return book.closedTrades().map((t) => ({
    source: "paper",
    asset: t.asset,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    notionalUsd: t.notionalUsd,
    pnlUsd: r2(t.pnlUsd),
    pnlPct: r2(t.pnlPct),
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    reason: t.reason,
  }));
}

export interface BuildPaperRecordsOptions {
  /** Asset → current mark price for unrealized P&L and NAV. */
  prices?: Record<string, number>;
  /** Legacy/backtest round trips carried over from the backtest handoff. */
  backtestTrips?: RoundTrip[];
  /** Timestamp of the latest paper check. */
  nowIso?: string;
}

/** Assemble the full studio-parity record set from a PaperBook. */
export function buildPaperRecords(book: PaperBook, opts: BuildPaperRecordsOptions = {}): PaperRecords {
  const prices = opts.prices ?? {};
  const paperTrips = paperTripsFrom(book);
  const backtestTrips = (opts.backtestTrips ?? []).map((t) => ({ ...t, source: "backtest" as const }));
  const roundTrips = [...backtestTrips, ...paperTrips];

  const openPositions: OpenMark[] = book.openPositions().map((p) => {
    const markPrice = prices[p.asset] ?? p.entryPrice;
    const markValue = p.quantity * markPrice;
    const unrealizedUsd = markValue - p.notionalUsd;
    return {
      asset: p.asset,
      entryPrice: p.entryPrice,
      markPrice,
      quantity: p.quantity,
      notionalUsd: p.notionalUsd,
      unrealizedUsd: r2(unrealizedUsd),
      unrealizedPct: r2((unrealizedUsd / p.notionalUsd) * 100),
      openedAt: p.openedAt,
    };
  });

  const openMarkUsd = r2(openPositions.reduce((s, p) => s + p.quantity * p.markPrice, 0));
  const unrealizedPnlUsd = r2(openPositions.reduce((s, p) => s + p.unrealizedUsd, 0));
  const realizedPnlUsd = r2(paperTrips.reduce((s, t) => s + t.pnlUsd, 0));

  return {
    navUsd: r2(book.equity(prices)),
    cashUsd: r2(book.cash),
    openMarkUsd,
    realizedPnlUsd,
    unrealizedPnlUsd,
    openPositions,
    roundTrips,
    performance: computePerformance(roundTrips),
    ...(opts.nowIso ? { latestCheckAt: opts.nowIso } : {}),
  };
}

/** Filter round trips by source (the dashboard's source filter). */
export function filterTripsBySource(trips: RoundTrip[], source: "paper" | "backtest" | "all"): RoundTrip[] {
  return source === "all" ? trips : trips.filter((t) => t.source === source);
}
