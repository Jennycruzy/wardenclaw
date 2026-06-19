import { describe, it, expect } from "vitest";
import {
  PaperBook,
  buildPaperRecords,
  computePerformance,
  filterTripsBySource,
  type RoundTrip,
} from "../src/index.js";

function bookWithTrades(): PaperBook {
  const book = new PaperBook(1000);
  // Win: buy 100 @100, sell @110 (no slippage).
  book.open({ asset: "NVDAx", refPrice: 100, notionalUsd: 100, stopPrice: 90, slippageBps: 0, timestamp: "2026-06-19T15:00:00Z" });
  book.close({ asset: "NVDAx", refPrice: 110, slippageBps: 0, timestamp: "2026-06-19T16:00:00Z", reason: "signal_exit" });
  // Loss: buy 100 @100, sell @95.
  book.open({ asset: "TSLAx", refPrice: 100, notionalUsd: 100, stopPrice: 90, slippageBps: 0, timestamp: "2026-06-19T15:00:00Z" });
  book.close({ asset: "TSLAx", refPrice: 95, slippageBps: 0, timestamp: "2026-06-19T16:00:00Z", reason: "stop" });
  return book;
}

describe("computePerformance", () => {
  it("is null with no closed trades (no premature stats)", () => {
    expect(computePerformance([])).toBeNull();
  });

  it("surfaces win-rate and profit-factor from a single closed trip", () => {
    const trip: RoundTrip = { source: "paper", asset: "NVDAx", entryPrice: 100, exitPrice: 110, notionalUsd: 100, pnlUsd: 10, pnlPct: 10, openedAt: "a", closedAt: "b", reason: "signal_exit" };
    const p = computePerformance([trip])!;
    expect(p.closedTrades).toBe(1);
    expect(p.winRatePct).toBe(100);
    expect(p.profitFactor).toBe(Infinity);
  });

  it("computes profit factor from wins and losses", () => {
    const trips: RoundTrip[] = [
      { source: "paper", asset: "A", entryPrice: 1, exitPrice: 1, notionalUsd: 100, pnlUsd: 20, pnlPct: 20, openedAt: "a", closedAt: "b", reason: "signal_exit" },
      { source: "paper", asset: "B", entryPrice: 1, exitPrice: 1, notionalUsd: 100, pnlUsd: -10, pnlPct: -10, openedAt: "a", closedAt: "b", reason: "stop" },
    ];
    const p = computePerformance(trips)!;
    expect(p.winRatePct).toBe(50);
    expect(p.profitFactor).toBe(2);
    expect(p.netPnlUsd).toBe(10);
  });
});

describe("buildPaperRecords", () => {
  it("computes NAV, realized PnL, and performance from a book", () => {
    const book = bookWithTrades();
    const rec = buildPaperRecords(book, { nowIso: "2026-06-19T16:00:00Z" });
    // +$10 win, -$5 loss → realized +$5; NAV back to 1005.
    expect(rec.realizedPnlUsd).toBe(5);
    expect(rec.navUsd).toBe(1005);
    expect(rec.performance!.closedTrades).toBe(2);
    expect(rec.performance!.winRatePct).toBe(50);
    expect(rec.latestCheckAt).toBe("2026-06-19T16:00:00Z");
  });

  it("marks an open position to market with unrealized P&L", () => {
    const book = new PaperBook(1000);
    book.open({ asset: "MSTRx", refPrice: 100, notionalUsd: 200, stopPrice: 90, slippageBps: 0, timestamp: "2026-06-19T15:00:00Z" });
    const rec = buildPaperRecords(book, { prices: { MSTRx: 110 } });
    expect(rec.openPositions).toHaveLength(1);
    expect(rec.openPositions[0]!.unrealizedUsd).toBeCloseTo(20, 1);
    expect(rec.unrealizedPnlUsd).toBeCloseTo(20, 1);
    expect(rec.navUsd).toBeCloseTo(1020, 1); // 800 cash + 220 mark
  });

  it("merges backtest round-trip backfills and filters by source", () => {
    const book = bookWithTrades();
    const backtest: RoundTrip[] = [
      { source: "backtest", asset: "AAPLx", entryPrice: 100, exitPrice: 105, notionalUsd: 100, pnlUsd: 5, pnlPct: 5, openedAt: "a", closedAt: "b", reason: "signal_exit" },
    ];
    const rec = buildPaperRecords(book, { backtestTrips: backtest });
    expect(rec.roundTrips).toHaveLength(3);
    expect(filterTripsBySource(rec.roundTrips, "paper")).toHaveLength(2);
    expect(filterTripsBySource(rec.roundTrips, "backtest")).toHaveLength(1);
    expect(rec.performance!.closedTrades).toBe(3);
  });
});
