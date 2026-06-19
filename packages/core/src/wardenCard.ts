/**
 * Warden Card cryptographic core — the shared signing / hashing / chain rules used
 * by BOTH the Strategy Safety Card (Playbook Shield) and the Trade Permit
 * (Trade-Permit Engine). One artifact type, different subjects.
 *
 * What this guarantees:
 *  - Canonical serialization (recursively sorted keys) so a card's hash and
 *    signature reproduce byte-for-byte across runs and machines.
 *  - `json_hash` = SHA-256 over the canonical body (everything the card asserts,
 *    including `prev_card_hash`). Any field mutation changes it.
 *  - `signature` = HMAC-SHA256 over the canonical {body, json_hash} with a secret
 *    key (env `WARDEN_SIGNING_KEY`; a fixed, clearly-labeled dev key when absent so
 *    offline demos still verify). The executor verifies this INDEPENDENTLY before
 *    any order — this is what makes "no valid permit = no execution" real.
 *  - Hash chain: every card embeds `prev_card_hash`; an append-only log of cards
 *    can be re-verified end to end, and a single mutated card breaks the chain
 *    from that point forward.
 *
 * The card is fail-closed: verification returns an explicit failure reason; callers
 * must treat anything other than `ok` as "no valid card".
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Genesis previous-card hash (first card in a chain). */
export const GENESIS_CARD_HASH = "0".repeat(64);

/**
 * Fixed development signing key, used ONLY when `WARDEN_SIGNING_KEY` is absent so
 * that offline demos and the test suite still produce verifiable cards. It is not
 * a secret; a real deployment must set `WARDEN_SIGNING_KEY`.
 */
export const DEV_SIGNING_KEY = "wardenclaw-dev-signing-key-not-for-production";

/** Resolve the signing key from env, falling back to the labeled dev key. */
export function resolveSigningKey(env: Record<string, string | undefined> = process.env): string {
  const k = env.WARDEN_SIGNING_KEY;
  return k && k.length > 0 ? k : DEV_SIGNING_KEY;
}

/** Whether the dev key is in use (surfaced in UI/logs so it's never mistaken for prod). */
export function usingDevSigningKey(env: Record<string, string | undefined> = process.env): boolean {
  return !(env.WARDEN_SIGNING_KEY && env.WARDEN_SIGNING_KEY.length > 0);
}

/**
 * Canonical JSON: objects get their keys sorted recursively; arrays keep order;
 * `undefined` properties are dropped (as JSON.stringify already does). Numbers use
 * JavaScript's default lossless representation — keep config values to plain
 * decimals/integers so serialization is stable.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

/** SHA-256 of the canonical serialization of any payload. */
export function sha256Canonical(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

/** HMAC-SHA256 (hex) of the canonical serialization, keyed by the signing key. */
export function hmacCanonical(payload: unknown, key: string): string {
  return createHmac("sha256", key).update(canonicalize(payload)).digest("hex");
}

/** The chain/signing envelope every card carries. */
export interface CardEnvelope {
  prev_card_hash: string;
  json_hash: string;
  signature: string;
  verification_status: "signed" | "verified" | "failed";
}

export type SignedCard<TBody> = TBody & CardEnvelope;

/**
 * Seal a card body: compute `json_hash` over {body + prev_card_hash}, then
 * `signature` over {body + prev_card_hash + json_hash}, and stamp the envelope.
 * The returned object is the canonical, verifiable card.
 */
export function sealCard<TBody extends object>(
  body: TBody,
  opts: { prevCardHash?: string; signingKey?: string } = {},
): SignedCard<TBody> {
  const prev_card_hash = opts.prevCardHash ?? GENESIS_CARD_HASH;
  const key = opts.signingKey ?? resolveSigningKey();
  const json_hash = sha256Canonical({ ...body, prev_card_hash });
  const signature = hmacCanonical({ ...body, prev_card_hash, json_hash }, key);
  return { ...body, prev_card_hash, json_hash, signature, verification_status: "signed" };
}

export interface CardVerification {
  ok: boolean;
  /** Machine reason when not ok. */
  reason?: "hash_mismatch" | "signature_mismatch" | "expired";
  detail?: string;
}

/** Strip the envelope back to the signed body (for re-hashing). */
function bodyOf<TBody>(card: SignedCard<TBody>): Record<string, unknown> {
  const { json_hash: _j, signature: _s, verification_status: _v, prev_card_hash: _p, ...rest } =
    card as SignedCard<Record<string, unknown>>;
  return rest;
}

/**
 * Independently verify a card: recompute `json_hash` (catches any body/chain
 * mutation), then the HMAC signature (catches forgery), then optional expiry. Any
 * failure is fail-closed with a specific reason.
 */
export function verifyCard<TBody>(
  card: SignedCard<TBody>,
  opts: { signingKey?: string; nowIso?: string; expiresAtIso?: string } = {},
): CardVerification {
  const key = opts.signingKey ?? resolveSigningKey();
  const body = bodyOf(card);

  const expectedHash = sha256Canonical({ ...body, prev_card_hash: card.prev_card_hash });
  if (expectedHash !== card.json_hash) {
    return { ok: false, reason: "hash_mismatch", detail: "json_hash does not match card body" };
  }

  const expectedSig = hmacCanonical(
    { ...body, prev_card_hash: card.prev_card_hash, json_hash: card.json_hash },
    key,
  );
  if (!timingSafeEqualHex(expectedSig, card.signature)) {
    return { ok: false, reason: "signature_mismatch", detail: "HMAC signature invalid" };
  }

  if (opts.expiresAtIso && opts.nowIso && opts.nowIso > opts.expiresAtIso) {
    return { ok: false, reason: "expired", detail: `now ${opts.nowIso} > expiry ${opts.expiresAtIso}` };
  }

  return { ok: true };
}

/** Constant-time hex comparison that tolerates unequal lengths without throwing. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify an append-only chain of cards. Returns the index of the first card whose
 * `prev_card_hash` does not match the prior card's `json_hash`, or whose own
 * hash/signature fails — or -1 when the whole chain is intact.
 */
export function verifyCardChain<TBody>(
  cards: SignedCard<TBody>[],
  opts: { signingKey?: string } = {},
): number {
  let prev = GENESIS_CARD_HASH;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    if (card.prev_card_hash !== prev) return i;
    const v = verifyCard(card, opts);
    if (!v.ok) return i;
    prev = card.json_hash;
  }
  return -1;
}
