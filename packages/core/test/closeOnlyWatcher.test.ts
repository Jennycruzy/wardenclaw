import { describe, it, expect } from "vitest";
import {
  assessCloseOnly,
  CloseOnlyController,
  verifyCard,
  type OpenPositionState,
  type AccountSignals,
} from "../src/index.js";

const KEY = "test-key";
const calmSignals: AccountSignals = { btcRealizedVolRising: false, fundingDeteriorating: false };
const safePos: OpenPositionState = { asset: "MSTRx", btcCorrelated: true, leverage: 2, entryPrice: 100, currentPrice: 100 };

describe("assessCloseOnly", () => {
  it("stays inactive when positions are safe and signals are calm", () => {
    expect(assessCloseOnly([safePos], calmSignals).active).toBe(false);
  });

  it("flips on a BTC vol spike for a correlated holding", () => {
    const a = assessCloseOnly([safePos], { btcRealizedVolRising: true, fundingDeteriorating: false });
    expect(a.active).toBe(true);
    expect(a.triggers).toContain("btc_vol_spike");
  });

  it("flips on a shrinking liquidation distance (high leverage)", () => {
    const a = assessCloseOnly([{ ...safePos, leverage: 20 }], calmSignals);
    expect(a.active).toBe(true);
    expect(a.triggers).toContain("liquidation_distance");
  });

  it("flips on funding deterioration with open positions", () => {
    const a = assessCloseOnly([safePos], { btcRealizedVolRising: false, fundingDeteriorating: true });
    expect(a.active).toBe(true);
    expect(a.triggers).toContain("funding_deterioration");
  });
});

describe("CloseOnlyController state machine", () => {
  it("emits a signed 'entered' card on the first trip and 'cleared' on recovery", () => {
    const c = new CloseOnlyController(undefined, KEY);
    expect(c.isActive).toBe(false);

    const enter = c.update([safePos], { btcRealizedVolRising: true, fundingDeteriorating: false }, "2026-06-19T15:00:00Z");
    expect(c.isActive).toBe(true);
    expect(enter.card!.transition).toBe("entered");
    expect(verifyCard(enter.card!, { signingKey: KEY }).ok).toBe(true);

    // No transition while it stays active → no card.
    const stay = c.update([safePos], { btcRealizedVolRising: true, fundingDeteriorating: false }, "2026-06-19T15:01:00Z");
    expect(stay.card).toBeNull();

    const clear = c.update([safePos], calmSignals, "2026-06-19T15:02:00Z");
    expect(c.isActive).toBe(false);
    expect(clear.card!.transition).toBe("cleared");
    expect(clear.card!.prev_card_hash).toBe(enter.card!.json_hash);
  });
});
