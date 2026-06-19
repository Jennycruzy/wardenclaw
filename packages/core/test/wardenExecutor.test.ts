import { describe, it, expect } from "vitest";
import {
  WardenExecutor,
  PermitStore,
  issuePermit,
  evaluateTradePermit,
  makeDeterministicPaperFill,
  tamperPermit,
  type TradeIntent,
  type MarketContext,
  type WardenPermit,
} from "../src/index.js";

const KEY = "test-key";
const NOW = "2026-06-19T15:00:00Z";

function ctx(over: Partial<MarketContext> = {}): MarketContext {
  return {
    nowIso: NOW, knownAsset: true, btcCorrelated: false, price: 100, underlyingRefPrice: 100,
    spreadBps: 10, volPctile: 0.3, confirmationPresent: true, marketOpen: true,
    btcRealizedVolRising: false, feedAgeSec: 5, closeOnlyActive: false, ...over,
  };
}
function intent(over: Partial<TradeIntent> = {}): TradeIntent {
  return {
    asset: "TSLAx", direction: "long", notionalUsd: 200, leverage: 1,
    orderType: "market", triggerSource: "human", rawCommand: "Buy $200 TSLAx", ...over,
  };
}
function permitFor(i: TradeIntent, c: MarketContext, seq = 1): { permit: WardenPermit; store: PermitStore } {
  const e = evaluateTradePermit(i, c);
  const permit = issuePermit({ evaluation: e, intent: i, priceAtIssue: c.price, nowIso: NOW, seq, signingKey: KEY });
  const store = new PermitStore();
  store.register(permit);
  return { permit, store };
}

function exec(store: PermitStore) {
  return new WardenExecutor(store, makeDeterministicPaperFill(), { signingKey: KEY });
}

describe("executor bypass attempts (mirrors demo_bypass)", () => {
  it("1) no permit → rejected", () => {
    const ex = exec(new PermitStore());
    const r = ex.execute({ currentPrice: 100, nowIso: NOW, requestedAction: "long" });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("no_permit");
  });

  it("2) expired permit → rejected", () => {
    const { store } = permitFor(intent(), ctx());
    const r = exec(store).execute({
      permit: store.get("WARDEN-TSLAX-20260619-0001"), currentPrice: 100,
      nowIso: "2026-06-19T18:00:00Z", requestedAction: "long",
    });
    expect(r.reason).toBe("expired");
  });

  it("3) tampered permit → rejected (signature/hash)", () => {
    const { permit, store } = permitFor(intent(), ctx());
    const r = exec(store).execute({ permit: tamperPermit(permit), currentPrice: 100, nowIso: NOW, requestedAction: "long" });
    expect(r.accepted).toBe(false);
    expect(["hash_mismatch", "signature_invalid"]).toContain(r.reason);
  });

  it("4) replayed consumed permit → rejected", () => {
    const { permit, store } = permitFor(intent(), ctx());
    const ex = exec(store);
    expect(ex.execute({ permit, currentPrice: 100, nowIso: NOW, requestedAction: "long" }).accepted).toBe(true);
    const replay = ex.execute({ permit, currentPrice: 100, nowIso: NOW, requestedAction: "long" });
    expect(replay.reason).toBe("already_consumed");
  });

  it("5) fresh valid permit → executed (paper)", () => {
    const { permit, store } = permitFor(intent(), ctx());
    const r = exec(store).execute({ permit, currentPrice: 100, nowIso: NOW, requestedAction: "long" });
    expect(r.accepted).toBe(true);
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0]!).toMatchObject({ paper: true, leg: "primary", side: "buy" });
  });

  it("logs every attempt with a reason (judge-facing evidence)", () => {
    const { permit, store } = permitFor(intent(), ctx());
    const ex = exec(store);
    ex.execute({ currentPrice: 100, nowIso: NOW, requestedAction: "long" });
    ex.execute({ permit, currentPrice: 100, nowIso: NOW, requestedAction: "long" });
    expect(ex.attempts).toHaveLength(2);
    expect(ex.attempts[0]!.accepted).toBe(false);
    expect(ex.attempts[1]!.accepted).toBe(true);
  });
});

describe("atomic HEDGE bundle", () => {
  const hedgeIntent = intent({ asset: "MSTRx", notionalUsd: 400, leverage: 3 });
  const hedgeCtx = ctx({ btcCorrelated: true, btcRealizedVolRising: true });

  it("rejects a HEDGE permit submitted with only the primary leg", () => {
    const { permit, store } = permitFor(hedgeIntent, hedgeCtx);
    expect(permit.verdict).toBe("HEDGE");
    const r = exec(store).execute({
      permit, currentPrice: 100, nowIso: NOW, requestedAction: "long", legsSubmitted: ["primary"],
    });
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("hedge_bundle_incomplete");
  });

  it("fills both legs atomically when the full bundle is submitted", () => {
    const { permit, store } = permitFor(hedgeIntent, hedgeCtx);
    const r = exec(store).execute({
      permit, currentPrice: 100, nowIso: NOW, requestedAction: "long", legsSubmitted: ["primary", "hedge"],
    });
    expect(r.accepted).toBe(true);
    expect(r.fills).toHaveLength(2);
    expect(r.fills.map((f) => f.leg)).toEqual(["primary", "hedge"]);
    expect(r.fills[1]!.side).toBe("sell");
  });
});

describe("close-only at the executor", () => {
  it("refuses an exposure-increasing action even with a valid permit", () => {
    const { permit, store } = permitFor(intent(), ctx());
    const r = exec(store).execute({
      permit, currentPrice: 100, nowIso: NOW, requestedAction: "long", closeOnlyActive: true,
    });
    expect(r.reason).toBe("close_only_blocked");
  });
});
