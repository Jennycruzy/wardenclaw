import { describe, it, expect } from "vitest";
import {
  armedTriggers,
  evaluateWatchdog,
  type WatchdogConfig,
  type WatchdogPositionState,
} from "../src/watchdog.js";

const cfg: WatchdogConfig = {
  takeProfitPct: 0.015,
  maxHoldBars: 48,
  sentimentExitMinConfidence: 0.65,
};

function pos(over: Partial<WatchdogPositionState> = {}): WatchdogPositionState {
  return { entryPrice: 100, stopPrice: 99, currentPrice: 100.5, heldBars: 2, ...over };
}

describe("armedTriggers", () => {
  it("lists every armed trigger under the full config", () => {
    expect(armedTriggers(cfg)).toEqual([
      "volatility_stop",
      "take_profit",
      "sentiment_reversal",
      "max_hold",
    ]);
  });

  it("always arms the volatility stop, optional triggers only when configured", () => {
    expect(armedTriggers({})).toEqual(["volatility_stop"]);
  });
});

describe("evaluateWatchdog", () => {
  it("returns null when no trigger fires", () => {
    expect(evaluateWatchdog(pos(), cfg)).toBeNull();
  });

  it("fires execute_stop_exit when price breaches the volatility stop", () => {
    const d = evaluateWatchdog(pos({ currentPrice: 98.9 }), cfg);
    expect(d).toMatchObject({ trigger: "volatility_stop", action: "execute_stop_exit" });
  });

  it("closes at the profit target", () => {
    const d = evaluateWatchdog(pos({ currentPrice: 101.6 }), cfg);
    expect(d).toMatchObject({ trigger: "take_profit", action: "close_position" });
  });

  it("exits when sentiment reverses with enough confidence", () => {
    const d = evaluateWatchdog(pos(), cfg, {
      direction: "negative",
      confidence: 0.8,
      tradeRelevance: "high",
    });
    expect(d).toMatchObject({ trigger: "sentiment_reversal", action: "close_position" });
    expect(d!.reason).toContain("sentiment reversed");
  });

  it("ignores a low-confidence negative event", () => {
    const d = evaluateWatchdog(pos(), cfg, {
      direction: "negative",
      confidence: 0.4,
      tradeRelevance: "high",
    });
    expect(d).toBeNull();
  });

  it("ignores a low-relevance negative event", () => {
    const d = evaluateWatchdog(pos(), cfg, {
      direction: "negative",
      confidence: 0.9,
      tradeRelevance: "low",
    });
    expect(d).toBeNull();
  });

  it("ignores positive/neutral events", () => {
    for (const direction of ["positive", "neutral", "mixed", "unknown"] as const) {
      expect(
        evaluateWatchdog(pos(), cfg, { direction, confidence: 0.99, tradeRelevance: "high" }),
      ).toBeNull();
    }
  });

  it("does not run the sentiment exit when it is not configured", () => {
    const d = evaluateWatchdog(pos(), { takeProfitPct: 0.015, maxHoldBars: 48 }, {
      direction: "negative",
      confidence: 0.99,
      tradeRelevance: "high",
    });
    expect(d).toBeNull();
  });

  it("closes on the max-hold time exit", () => {
    const d = evaluateWatchdog(pos({ heldBars: 48 }), cfg);
    expect(d).toMatchObject({ trigger: "max_hold", action: "close_position" });
  });

  it("the stop beats every other trigger; the target beats the sentiment exit", () => {
    const stop = evaluateWatchdog(pos({ currentPrice: 98.5, heldBars: 99 }), cfg, {
      direction: "negative",
      confidence: 0.9,
      tradeRelevance: "high",
    });
    expect(stop!.trigger).toBe("volatility_stop");
    const target = evaluateWatchdog(pos({ currentPrice: 102 }), cfg, {
      direction: "negative",
      confidence: 0.9,
      tradeRelevance: "high",
    });
    expect(target!.trigger).toBe("take_profit");
  });
});
