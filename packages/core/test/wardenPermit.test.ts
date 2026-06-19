import { describe, it, expect } from "vitest";
import {
  issuePermit,
  PermitStore,
  validatePermitForExecution,
  verifyCardChain,
  evaluateTradePermit,
  verdictIssuesPermit,
  type TradeIntent,
  type MarketContext,
  type WardenPermit,
} from "../src/index.js";

const KEY = "test-key";
const NOW = "2026-06-19T15:00:00Z";

function calmCtx(over: Partial<MarketContext> = {}): MarketContext {
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

function freshPermit(over: { seq?: number; prevCardHash?: string } = {}): WardenPermit {
  const i = intent();
  const e = evaluateTradePermit(i, calmCtx());
  return issuePermit({
    evaluation: e, intent: i, priceAtIssue: 100, nowIso: NOW, seq: over.seq ?? 1,
    signingKey: KEY, ...(over.prevCardHash ? { prevCardHash: over.prevCardHash } : {}),
  });
}

describe("permit issuance", () => {
  it("only non-BLOCK verdicts issue a permit", () => {
    expect(verdictIssuesPermit("APPROVE")).toBe(true);
    expect(verdictIssuesPermit("DELAY")).toBe(true);
    expect(verdictIssuesPermit("BLOCK")).toBe(false);
    expect(verdictIssuesPermit("CLOSE_ONLY")).toBe(false);
  });

  it("issues a signed permit with a structured id and the approved order", () => {
    const p = freshPermit();
    expect(p.permit_id).toMatch(/^WARDEN-TSLAX-20260619-0001$/);
    expect(p.subject).toBe("trade_permit");
    expect(p.approved_order).toMatchObject({ asset: "TSLAx", notionalUsd: 200 });
    expect(p.verification_status).toBe("signed");
  });

  it("throws when asked to issue a permit for a BLOCK", () => {
    const i = intent({ leverage: 30 });
    const e = evaluateTradePermit(i, calmCtx());
    expect(e.verdict).toBe("BLOCK");
    expect(() => issuePermit({ evaluation: e, intent: i, priceAtIssue: 100, nowIso: NOW, seq: 1 })).toThrow();
  });
});

describe("execution validation", () => {
  function store(p: WardenPermit): PermitStore {
    const s = new PermitStore();
    s.register(p);
    return s;
  }

  it("accepts a fresh, in-band, unconsumed permit for the right action", () => {
    const p = freshPermit();
    const r = validatePermitForExecution({
      permit: p, store: store(p), currentPrice: 100, nowIso: NOW, requestedAction: "long", signingKey: KEY,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses a tampered permit (signature/hash)", () => {
    const p = freshPermit();
    const tampered = { ...p, approved_order: { ...p.approved_order!, notionalUsd: 999999 } };
    const r = validatePermitForExecution({
      permit: tampered, store: store(p), currentPrice: 100, nowIso: NOW, requestedAction: "long", signingKey: KEY,
    });
    expect(r.ok).toBe(false);
    expect(["hash_mismatch", "signature_invalid"]).toContain(r.reason);
  });

  it("refuses an expired permit", () => {
    const p = freshPermit();
    const r = validatePermitForExecution({
      permit: p, store: store(p), currentPrice: 100,
      nowIso: "2026-06-19T16:00:00Z", requestedAction: "long", signingKey: KEY,
    });
    expect(r.reason).toBe("expired");
  });

  it("refuses a replayed (already consumed) permit", () => {
    const p = freshPermit();
    const s = store(p);
    expect(s.consume(p.permit_id)).toBe(true);
    expect(s.consume(p.permit_id)).toBe(false); // second consume fails
    const r = validatePermitForExecution({
      permit: p, store: s, currentPrice: 100, nowIso: NOW, requestedAction: "long", signingKey: KEY,
    });
    expect(r.reason).toBe("already_consumed");
  });

  it("refuses when the price has drifted beyond the band", () => {
    const p = freshPermit();
    const r = validatePermitForExecution({
      permit: p, store: store(p), currentPrice: 105, nowIso: NOW, requestedAction: "long", signingKey: KEY,
    });
    expect(r.reason).toBe("price_drift");
    expect(r.priceDriftPct).toBeCloseTo(5, 1);
  });

  it("refuses when the requested action does not match the permit", () => {
    const p = freshPermit();
    const r = validatePermitForExecution({
      permit: p, store: store(p), currentPrice: 100, nowIso: NOW, requestedAction: "close", signingKey: KEY,
    });
    expect(r.reason).toBe("action_mismatch");
  });

  it("refuses when a binding gate flipped since issuance", () => {
    const p = freshPermit();
    const r = validatePermitForExecution({
      permit: p, store: store(p), currentPrice: 100, nowIso: NOW, requestedAction: "long", signingKey: KEY, gateFlipped: true,
    });
    expect(r.reason).toBe("gate_flipped");
  });
});

describe("hash chain", () => {
  it("chains permits and detects a mutation downstream", () => {
    const p1 = freshPermit({ seq: 1 });
    const p2 = freshPermit({ seq: 2, prevCardHash: p1.json_hash });
    expect(verifyCardChain([p1, p2], { signingKey: KEY })).toBe(-1);
    const broken = [p1, { ...p2, asset: "EVILx" } as typeof p2];
    expect(verifyCardChain(broken, { signingKey: KEY })).toBe(1);
  });
});
