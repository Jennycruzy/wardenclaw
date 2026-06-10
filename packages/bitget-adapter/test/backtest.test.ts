import { describe, it, expect } from "vitest";
import { backtestReactor, candlesToBars } from "../src/index.js";
import type { BitgetCandle } from "../src/index.js";
import { flatCandles, shockSeries, appendCalm } from "./helpers.js";

/** Build a longer series with a shock followed by a sustained run-up. */
function runUpSeries(): BitgetCandle[] {
  let bars = shockSeries({ flatBars: 8, shockPct: 0.06, shockVolumeMult: 3 });
  bars = appendCalm(bars, 12, 0.01); // sustained continuation
  return bars;
}

describe("backtestReactor", () => {
  it("produces a PnL/drawdown report on a shock-and-run series", () => {
    const result = backtestReactor(runUpSeries());
    expect(result).toHaveProperty("pnlUsd");
    expect(result).toHaveProperty("maxDrawdownPct");
    expect(result).toHaveProperty("totalReturnPct");
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });

  it("takes at least one trade when a confirmed continuation appears", () => {
    const result = backtestReactor(runUpSeries());
    expect(result.numTrades).toBeGreaterThanOrEqual(1);
  });

  it("takes no trades on a flat series (no shock to react to)", () => {
    const result = backtestReactor(flatCandles(40));
    expect(result.numTrades).toBe(0);
  });

  it("candlesToBars attaches a positive ATR estimate", () => {
    const bars = candlesToBars(runUpSeries());
    expect(bars.every((b) => b.atrPct >= 0)).toBe(true);
    expect(bars.some((b) => b.atrPct > 0)).toBe(true);
  });
});
