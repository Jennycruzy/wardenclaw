import { describe, it, expect } from "vitest";
import {
  sealCard,
  verifyCard,
  verifyCardChain,
  canonicalize,
  sha256Canonical,
  GENESIS_CARD_HASH,
  DEV_SIGNING_KEY,
  resolveSigningKey,
  usingDevSigningKey,
  type SignedCard,
} from "../src/wardenCard.js";

const KEY = "test-key";

describe("canonical serialization", () => {
  it("sorts object keys recursively so hashes reproduce regardless of input order", () => {
    const a = canonicalize({ b: 1, a: { d: 4, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 4 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it("drops undefined fields and preserves array order", () => {
    expect(canonicalize({ x: undefined, y: [3, 1, 2] })).toBe('{"y":[3,1,2]}');
  });

  it("produces a stable sha256 across equivalent objects", () => {
    expect(sha256Canonical({ a: 1, b: 2 })).toBe(sha256Canonical({ b: 2, a: 1 }));
  });
});

describe("signing key resolution", () => {
  it("uses the dev key (clearly labeled) when env is absent", () => {
    expect(resolveSigningKey({})).toBe(DEV_SIGNING_KEY);
    expect(usingDevSigningKey({})).toBe(true);
  });
  it("uses the env key when present", () => {
    expect(resolveSigningKey({ WARDEN_SIGNING_KEY: "prod" })).toBe("prod");
    expect(usingDevSigningKey({ WARDEN_SIGNING_KEY: "prod" })).toBe(false);
  });
});

describe("seal + verify", () => {
  const body = { subject: "strategy", verdict: "Certified", n: 3 };

  it("seals a card that verifies under the same key", () => {
    const card = sealCard(body, { signingKey: KEY });
    expect(card.prev_card_hash).toBe(GENESIS_CARD_HASH);
    expect(card.verification_status).toBe("signed");
    expect(verifyCard(card, { signingKey: KEY }).ok).toBe(true);
  });

  it("fails hash check when any body field is mutated", () => {
    const card = sealCard(body, { signingKey: KEY });
    const tampered = { ...card, verdict: "Rejected" } as SignedCard<typeof body>;
    const v = verifyCard(tampered, { signingKey: KEY });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("hash_mismatch");
  });

  it("fails signature check when the json_hash is forged to match a mutated body", () => {
    const card = sealCard(body, { signingKey: KEY });
    // Recompute json_hash for a mutated body but cannot forge the HMAC without the key.
    const mutated = { ...card, verdict: "Rejected" };
    const forged = {
      ...mutated,
      json_hash: sha256Canonical({
        subject: mutated.subject,
        verdict: mutated.verdict,
        n: mutated.n,
        prev_card_hash: mutated.prev_card_hash,
      }),
    } as SignedCard<typeof body>;
    const v = verifyCard(forged, { signingKey: KEY });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("signature_mismatch");
  });

  it("fails signature check under a different key", () => {
    const card = sealCard(body, { signingKey: KEY });
    expect(verifyCard(card, { signingKey: "other" }).reason).toBe("signature_mismatch");
  });

  it("enforces expiry when now is past expires_at", () => {
    const card = sealCard(body, { signingKey: KEY });
    const v = verifyCard(card, {
      signingKey: KEY,
      nowIso: "2026-06-19T12:00:00Z",
      expiresAtIso: "2026-06-19T11:00:00Z",
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("expired");
  });
});

describe("hash chain", () => {
  it("links cards and detects a mutation downstream of the break", () => {
    const c1 = sealCard({ subject: "a", v: 1 }, { signingKey: KEY });
    const c2 = sealCard({ subject: "b", v: 2 }, { prevCardHash: c1.json_hash, signingKey: KEY });
    const c3 = sealCard({ subject: "c", v: 3 }, { prevCardHash: c2.json_hash, signingKey: KEY });
    expect(verifyCardChain([c1, c2, c3], { signingKey: KEY })).toBe(-1);

    const broken = [c1, { ...c2, v: 99 } as typeof c2, c3];
    expect(verifyCardChain(broken, { signingKey: KEY })).toBe(1);
  });
});
