import { describe, it, expect } from "vitest";
import {
  ghostSimulate,
  ghostCompare,
  liquidationPrice,
  type SimOrder,
  type SimCandle,
} from "../src/index.js";

// Hand-computable path: entry 100, drifts down to 80 then back to 90.
const path: SimCandle[] = [
  { time: "t0", open: 100, high: 101, low: 95, close: 96 },
  { time: "t1", open: 96, high: 97, low: 80, close: 85 },
  { time: "t2", open: 85, high: 92, low: 84, close: 90 },
];

describe("liquidationPrice", () => {
  it("spot long can only go to zero", () => {
    expect(liquidationPrice({ side: "long", notionalUsd: 100, leverage: 1, entryPrice: 100 }, 0.005)).toBe(0);
  });
  it("10x long liquidates ~9.5% below entry", () => {
    const liq = liquidationPrice({ side: "long", notionalUsd: 100, leverage: 10, entryPrice: 100 }, 0.005);
    expect(liq).toBeCloseTo(90.5, 4);
  });
});

describe("ghostSimulate", () => {
  it("a 10x long over the path liquidates (low 80 < liq 90.5)", () => {
    const order: SimOrder = { side: "long", notionalUsd: 100, leverage: 10, entryPrice: 100 };
    const r = ghostSimulate(order, path);
    expect(r.liquidated).toBe(true);
    expect(r.liquidatedAt).toBe("t1");
    expect(r.maxDrawdownPct).toBe(1);
    expect(r.finalPnlUsd).toBe(-100);
  });

  it("a 1x spot long over the path survives and ends down 10%", () => {
    const order: SimOrder = { side: "long", notionalUsd: 100, leverage: 1, entryPrice: 100 };
    const r = ghostSimulate(order, path);
    expect(r.liquidated).toBe(false);
    // final close 90 → -10% on 1x → -$10.
    expect(r.finalPnlUsd).toBeCloseTo(-10, 4);
    expect(r.worstPrice).toBe(80);
  });

  it("a 2x long survives (liq ~50.5) but draws down hard", () => {
    const order: SimOrder = { side: "long", notionalUsd: 100, leverage: 2, entryPrice: 100 };
    const r = ghostSimulate(order, path);
    expect(r.liquidated).toBe(false);
    // worst low 80 → 2x*(-20%) = -40% equity drawdown.
    expect(r.maxDrawdownPct).toBeCloseTo(0.4, 2);
  });
});

describe("ghostCompare — original vs Warden-adjusted", () => {
  it("shows the firewall avoiding a liquidation by deleveraging", () => {
    const original: SimOrder = { side: "long", notionalUsd: 500, leverage: 10, entryPrice: 100 };
    const adjusted: SimOrder = { side: "long", notionalUsd: 250, leverage: 2, entryPrice: 100 };
    const cmp = ghostCompare(original, adjusted, path);
    expect(cmp.original.liquidated).toBe(true);
    expect(cmp.wardenAdjusted.liquidated).toBe(false);
    expect(cmp.liquidationAvoided).toBe(true);
    expect(cmp.drawdownAvoidedUsd).toBeGreaterThan(0);
  });
});
