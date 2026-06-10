import { describe, it, expect } from "vitest";
import {
  computeFriction,
  evaluateNetEdge,
  evaluateStopCoherence,
  evaluateGovernor,
  evaluateShadowFill,
} from "../src/index.js";

describe("friction model", () => {
  it("computes round-trip bps from gas + slippage + lp fee + simulated cost", () => {
    const r = computeFriction({
      notionalUsd: 20,
      gasInUsd: 0.05,
      gasOutUsd: 0.05,
      expectedSlippageBps: 10,
      lpFeeBps: 25,
      scoringSimCostBps: 10,
      safetyBufferBps: 5,
    });
    // gas: (0.10/20)*10000 = 50 bps; slippage 20; lp 50; sim 20; buffer 5
    expect(r.breakdown.gasBps).toBeCloseTo(50, 5);
    expect(r.breakdown.slippageBps).toBe(20);
    expect(r.breakdown.lpFeeBps).toBe(50);
    expect(r.simulatedCostBps).toBe(20);
    expect(r.realFrictionBps).toBeCloseTo(125, 5);
    expect(r.frictionBps).toBeCloseTo(145, 5);
  });

  it("throws on non-positive notional", () => {
    expect(() => computeFriction({
      notionalUsd: 0,
      gasInUsd: 0,
      gasOutUsd: 0,
      expectedSlippageBps: 0,
      lpFeeBps: 0,
      scoringSimCostBps: 0,
    })).toThrow();
  });
});

describe("net-edge gate", () => {
  it("blocks a trade where expected move < friction + margin", () => {
    const r = evaluateNetEdge({ expectedMoveBps: 100, frictionBps: 90, netEdgeMinBps: 30 });
    expect(r.passed).toBe(false);
    expect(r.rejectCode).toBe("REJECT_NET_EDGE");
  });

  it("passes a clearly profitable setup", () => {
    const r = evaluateNetEdge({ expectedMoveBps: 200, frictionBps: 90, netEdgeMinBps: 30 });
    expect(r.passed).toBe(true);
    expect(r.marginBps).toBe(80);
  });

  it("bypasses for a forced safety exit", () => {
    const r = evaluateNetEdge({
      expectedMoveBps: 0,
      frictionBps: 500,
      netEdgeMinBps: 30,
      forcedSafetyExit: true,
    });
    expect(r.passed).toBe(true);
  });
});

describe("stop coherence", () => {
  const friction = (notional: number) => (notional <= 0 ? Infinity : (0.2 / notional) * 10000 + 80);

  it("derives stop from volatility and size from the stop", () => {
    const r = evaluateStopCoherence({
      portfolioUsd: 40,
      deployableUsd: 38,
      perTradeRiskPct: 3,
      stopAtrMultiple: 1.5,
      recentAtrPct: 0.04,
      maxPositionPct: 70,
      frictionBudgetBps: 200,
      estimateFrictionBps: friction,
    });
    // stop = 1.5 * 0.04 = 0.06; risk = 1.2; raw size = 1.2/0.06 = 20
    expect(r.stopDistancePct).toBeCloseTo(0.06, 5);
    expect(r.positionSizeUsd).toBeCloseTo(20, 5);
    expect(r.passed).toBe(true);
  });

  it("rejects when the volatility stop forces a size whose friction exceeds budget", () => {
    const r = evaluateStopCoherence({
      portfolioUsd: 40,
      deployableUsd: 38,
      perTradeRiskPct: 3,
      stopAtrMultiple: 1.5,
      recentAtrPct: 0.5, // huge noise → tiny size
      maxPositionPct: 70,
      frictionBudgetBps: 120,
      estimateFrictionBps: friction,
    });
    expect(r.passed).toBe(false);
    expect(r.rejectCode).toBe("REJECT_STOP_COHERENCE");
  });

  it("caps size by maxPositionPct", () => {
    const r = evaluateStopCoherence({
      portfolioUsd: 40,
      deployableUsd: 38,
      perTradeRiskPct: 50, // would imply huge size
      stopAtrMultiple: 1.5,
      recentAtrPct: 0.04,
      maxPositionPct: 70,
      frictionBudgetBps: 500,
      estimateFrictionBps: friction,
    });
    expect(r.positionSizeUsd).toBeCloseTo(0.7 * 38, 5);
  });
});

describe("drawdown governor", () => {
  const base = {
    competitionDqDrawdownPct: 30,
    internalWindowDrawdownPct: 15,
    maxDailyDrawdownPct: 6,
    kellyFraction: 0.25,
    edgeEstimate: 1,
    maxPositionFraction: 0.7,
  };

  it("presses size when the budget is healthy", () => {
    const r = evaluateGovernor({ ...base, state: { windowDrawdownPct: 0, dailyDrawdownPct: 0 } });
    expect(r.sizeFraction).toBeGreaterThan(0);
    expect(r.bindingLayer).toBe("daily"); // smallest cap with full budget still binds least-remaining
  });

  it("shrinks size as the binding budget thins", () => {
    const healthy = evaluateGovernor({ ...base, state: { windowDrawdownPct: 0, dailyDrawdownPct: 0 } });
    const thin = evaluateGovernor({ ...base, state: { windowDrawdownPct: 0, dailyDrawdownPct: 5 } });
    expect(thin.sizeFraction).toBeLessThan(healthy.sizeFraction);
  });

  it("forces size toward zero near the cap", () => {
    const r = evaluateGovernor({ ...base, state: { windowDrawdownPct: 0, dailyDrawdownPct: 6 } });
    expect(r.sizeFraction).toBe(0);
  });

  it("never exceeds maxPositionFraction", () => {
    const r = evaluateGovernor({
      ...base,
      kellyFraction: 10,
      state: { windowDrawdownPct: 0, dailyDrawdownPct: 0 },
    });
    expect(r.sizeFraction).toBeLessThanOrEqual(base.maxPositionFraction);
  });
});

describe("shadow fill", () => {
  it("aborts when simulated output deviates beyond tolerance", () => {
    const r = evaluateShadowFill({ expectedOut: 100, simulatedOut: 99, toleranceBps: 40 });
    expect(r.passed).toBe(false);
    expect(r.rejectCode).toBe("REJECT_SHADOW_FILL");
  });

  it("passes within tolerance and when receiving more", () => {
    expect(evaluateShadowFill({ expectedOut: 100, simulatedOut: 99.8, toleranceBps: 40 }).passed).toBe(true);
    expect(evaluateShadowFill({ expectedOut: 100, simulatedOut: 105, toleranceBps: 40 }).passed).toBe(true);
  });
});
