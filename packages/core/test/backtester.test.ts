import { describe, it, expect } from "vitest";
import { runBacktest, type Bar, type SignalFn, type BacktestConfig } from "../src/index.js";

const config: BacktestConfig = {
  startingCapitalUsd: 40,
  perTradeRiskPct: 3,
  stopAtrMultiple: 1.5,
  maxPositionPct: 70,
  netEdgeMinBps: 30,
  frictionBudgetBps: 300,
  scoringSimCostBps: 10,
  gasPerLegUsd: 0.02,
  slippageBps: 8,
  lpFeeBps: 25,
  safetyBufferBps: 5,
};

function ramp(prices: number[], atrPct = 0.04): Bar[] {
  return prices.map((price, i) => ({ time: `h${i}`, price, atrPct }));
}

describe("backtester", () => {
  it("opens on a strong signal and profits on an uptrend", () => {
    const bars = ramp([100, 101, 103, 106, 110]);
    const signal: SignalFn = (_bar, i, hasPos) =>
      i === 0 && !hasPos ? { score: 85, expectedMoveBps: 800 } : null;
    const result = runBacktest(bars, signal, config);
    expect(result.numTrades).toBe(1);
    expect(result.pnlUsd).toBeGreaterThan(0);
    expect(result.totalReturnPct).toBeGreaterThan(0);
  });

  it("rejects a signal that does not clear net edge", () => {
    const bars = ramp([100, 101, 102]);
    const signal: SignalFn = (_bar, i, hasPos) =>
      i === 0 && !hasPos ? { score: 66, expectedMoveBps: 10 } : null;
    const result = runBacktest(bars, signal, config);
    expect(result.numTrades).toBe(0);
    expect(result.rejections.REJECT_NET_EDGE).toBeGreaterThanOrEqual(1);
  });

  it("stops out and records the loss with friction", () => {
    const bars = ramp([100, 99, 95, 90]);
    const signal: SignalFn = (_bar, i, hasPos) =>
      i === 0 && !hasPos ? { score: 85, expectedMoveBps: 800 } : null;
    const result = runBacktest(bars, signal, config);
    expect(result.numTrades).toBe(1);
    expect(result.trades[0]!.reason).toBe("stop");
    expect(result.trades[0]!.pnlUsd).toBeLessThan(0);
    expect(result.maxDrawdownPct).toBeGreaterThan(0);
  });
});
