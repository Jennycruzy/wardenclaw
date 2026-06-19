import { describe, it, expect } from "vitest";
import {
  evaluateTradePermit,
  liquidationDistancePct,
  premiumPct,
  DEFAULT_TRADE_PERMIT_CONFIG,
  type TradeIntent,
  type MarketContext,
} from "../src/index.js";

/** A calm, safe baseline context — every gate passes unless a test overrides it. */
function calmCtx(over: Partial<MarketContext> = {}): MarketContext {
  return {
    nowIso: "2026-06-19T15:00:00Z",
    knownAsset: true,
    btcCorrelated: false,
    price: 100,
    underlyingRefPrice: 100,
    spreadBps: 10,
    volPctile: 0.3,
    earningsWithinHours: undefined,
    newsShockAgeMin: undefined,
    confirmationPresent: true,
    marketOpen: true,
    btcRealizedVolRising: false,
    feedAgeSec: 5,
    closeOnlyActive: false,
    ...over,
  };
}

function intent(over: Partial<TradeIntent> = {}): TradeIntent {
  return {
    asset: "TSLAx", direction: "long", notionalUsd: 200, leverage: 1,
    orderType: "market", triggerSource: "human", rawCommand: "test", ...over,
  };
}

describe("helpers", () => {
  it("computes liquidation distance (spot is safe; leverage shrinks it)", () => {
    expect(liquidationDistancePct(1, 0.005)).toBe(100);
    expect(liquidationDistancePct(10, 0.005)).toBeCloseTo(9.5, 1);
  });
  it("computes signed premium/discount", () => {
    expect(premiumPct(103, 100)).toBeCloseTo(3, 5);
    expect(premiumPct(97, 100)).toBeCloseTo(-3, 5);
    expect(premiumPct(100, undefined)).toBeUndefined();
  });
});

describe("canonical acceptance fixtures — six verdicts", () => {
  it("APPROVE: $200 TSLAx after open, volume confirmed, normal book → approved unchanged", () => {
    const r = evaluateTradePermit(intent({ asset: "TSLAx", notionalUsd: 200 }), calmCtx());
    expect(r.verdict).toBe("APPROVE");
    expect(r.approvedOrder).toMatchObject({ notionalUsd: 200, leverage: 1, orderType: "market" });
    expect(r.gatesFailed).toEqual([]);
  });

  it("REDUCE: NVDAx $500 5x in elevated vol → smaller, lower-leverage limit order", () => {
    const r = evaluateTradePermit(
      intent({ asset: "NVDAx", notionalUsd: 500, leverage: 5 }),
      calmCtx({ volPctile: 0.9 }),
    );
    expect(r.verdict).toBe("REDUCE");
    expect(r.approvedOrder!.notionalUsd).toBeLessThan(500);
    expect(r.approvedOrder!.leverage).toBeLessThanOrEqual(2);
    expect(r.approvedOrder!.orderType).toBe("limit");
    expect(r.modificationReason.length).toBeGreaterThan(0);
  });

  it("DELAY: buy immediately after fresh bullish news, no confirmation → delayed with a recheck", () => {
    const r = evaluateTradePermit(
      intent({ asset: "TSLAx" }),
      calmCtx({ newsShockAgeMin: 3, confirmationPresent: false }),
    );
    expect(r.verdict).toBe("DELAY");
    expect(r.recheckCondition).toBeTruthy();
    expect(r.approvedOrder).toBeUndefined();
  });

  it("HEDGE: MSTRx long 3x while BTC vol rising → smaller primary + enforced hedge leg", () => {
    const r = evaluateTradePermit(
      intent({ asset: "MSTRx", notionalUsd: 400, leverage: 3 }),
      calmCtx({ btcCorrelated: true, btcRealizedVolRising: true }),
    );
    expect(r.verdict).toBe("HEDGE");
    expect(r.approvedOrder!.notionalUsd).toBeLessThan(400);
    expect(r.hedgeLeg).toMatchObject({ asset: "MSTRx", direction: "short" });
    expect(r.hedgeLeg!.notionalUsd).toBeGreaterThan(0);
  });

  it("BLOCK: NVDAx $1000 8x before earnings → blocked, no order", () => {
    const r = evaluateTradePermit(
      intent({ asset: "NVDAx", notionalUsd: 1000, leverage: 8 }),
      calmCtx({ earningsWithinHours: 12, volPctile: 0.9 }),
    );
    expect(r.verdict).toBe("BLOCK");
    expect(r.approvedOrder).toBeUndefined();
    expect(r.gatesFailed).toContain("earnings_window");
  });

  it("CLOSE_ONLY: increase blocked while survival mode is active", () => {
    const r = evaluateTradePermit(
      intent({ asset: "MSTRx", direction: "long", leverage: 3 }),
      calmCtx({ closeOnlyActive: true, btcCorrelated: true }),
    );
    expect(r.verdict).toBe("CLOSE_ONLY");
    expect(r.approvedOrder).toBeUndefined();
  });

  it("CLOSE_ONLY: a risk-reducing command is still evaluated and permitted", () => {
    const r = evaluateTradePermit(
      intent({ asset: "MSTRx", direction: "reduce" }),
      calmCtx({ closeOnlyActive: true, btcCorrelated: true }),
    );
    expect(r.verdict).toBe("APPROVE");
  });
});

describe("fail-closed gates", () => {
  it("stale feed → BLOCK", () => {
    expect(evaluateTradePermit(intent(), calmCtx({ feedAgeSec: 999 })).verdict).toBe("BLOCK");
  });
  it("unknown asset → BLOCK", () => {
    expect(evaluateTradePermit(intent(), calmCtx({ knownAsset: false })).verdict).toBe("BLOCK");
  });
});

describe("individual gate thresholds", () => {
  const cfg = DEFAULT_TRADE_PERMIT_CONFIG;

  it("spread gate delays a wide book", () => {
    const r = evaluateTradePermit(intent(), calmCtx({ spreadBps: cfg.spreadMaxBps + 10 }));
    expect(r.verdict).toBe("DELAY");
    expect(r.gatesFailed).toContain("spread_slippage");
  });

  it("earnings window reduces at low leverage", () => {
    const r = evaluateTradePermit(intent({ leverage: 1 }), calmCtx({ earningsWithinHours: 10 }));
    expect(r.verdict).toBe("REDUCE");
    expect(r.gatesFailed).toContain("earnings_window");
  });

  it("premium gate fires on a weekend overnight command (tighter closed-session threshold)", () => {
    const r = evaluateTradePermit(intent(), calmCtx({ marketOpen: false, price: 101, underlyingRefPrice: 100 }));
    expect(r.gatesFailed).toContain("premium_discount");
    expect(["REDUCE", "DELAY"]).toContain(r.verdict);
  });

  it("liquidation distance blocks extreme leverage", () => {
    const r = evaluateTradePermit(intent({ leverage: 30 }), calmCtx());
    expect(r.gatesFailed).toContain("liquidation_distance");
    expect(r.verdict).toBe("BLOCK");
  });

  it("BLOCK dominates DELAY and HEDGE when several gates fire", () => {
    const r = evaluateTradePermit(
      intent({ asset: "MSTRx", leverage: 8 }),
      calmCtx({ btcCorrelated: true, btcRealizedVolRising: true, earningsWithinHours: 5, spreadBps: 99, newsShockAgeMin: 2, confirmationPresent: false }),
    );
    expect(r.verdict).toBe("BLOCK");
  });
});
