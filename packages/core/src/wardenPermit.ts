/**
 * Warden Permit — the signed, single-use authorization a non-BLOCK trade verdict
 * produces. Same artifact type as the Strategy Safety Card (different `subject`),
 * so it inherits canonical serialization + HMAC signature + hash chaining from
 * wardenCard.ts. On top of that it adds the execution-binding rules that make
 * "no valid permit = no execution" cryptographically real:
 *
 *   - Signature (not just hash): the executor verifies it INDEPENDENTLY.
 *   - Expiry: a permit past `expires_at` is refused.
 *   - Single-use: the store marks a permit consumed; resubmitting it is refused.
 *   - Market-state binding: invalid if the current price has drifted beyond
 *     `max_price_drift_pct` from `price_at_issue`, or if a re-checked gate flipped.
 *   - Hash chain: every permit embeds `prev_card_hash`; the log re-verifies end to end.
 *
 * `consumed` is deliberately NOT part of the signed body — a signed card is
 * immutable, so single-use state is tracked at runtime in the PermitStore and
 * merged into the displayed view. Everything else the verdict asserted is signed.
 */

import { sealCard, verifyCard, type SignedCard } from "./wardenCard.js";
import type {
  TradeVerdict,
  TradeIntent,
  ApprovedOrder,
  HedgeLeg,
  TradePermitEvaluation,
} from "./tradePermit.js";

export interface WardenPermitBody {
  subject: "trade_permit";
  permit_id: string;
  created_at: string;
  expires_at: string;
  asset: string;
  direction: TradeIntent["direction"];
  original_command: string;
  approved_order: ApprovedOrder | null;
  verdict: TradeVerdict;
  risk_flags: string[];
  gates_passed: string[];
  gates_failed: string[];
  modification_reason: string[];
  trigger_source: "human" | "ai_agent";
  price_at_issue: number;
  max_price_drift_pct: number;
  hedge_leg: HedgeLeg | null;
}

export type WardenPermit = SignedCard<WardenPermitBody>;

/** Per-verdict default permit lifetimes (minutes). */
export const DEFAULT_PERMIT_EXPIRY_MIN: Record<TradeVerdict, number> = {
  APPROVE: 15,
  REDUCE: 15,
  HEDGE: 15,
  DELAY: 30,
  BLOCK: 0,
  CLOSE_ONLY: 0,
};

/** Verdicts that produce a permit at all (BLOCK and a CLOSE_ONLY refusal do not). */
export function verdictIssuesPermit(verdict: TradeVerdict): boolean {
  return verdict === "APPROVE" || verdict === "REDUCE" || verdict === "HEDGE" || verdict === "DELAY";
}

/** Verdicts whose permit the executor may actually act on (DELAY is not executable). */
export function verdictIsExecutable(verdict: TradeVerdict): boolean {
  return verdict === "APPROVE" || verdict === "REDUCE" || verdict === "HEDGE";
}

function yyyymmdd(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

export interface IssuePermitInput {
  evaluation: TradePermitEvaluation;
  intent: TradeIntent;
  priceAtIssue: number;
  nowIso: string;
  seq: number;
  maxPriceDriftPct?: number;
  expiryMinutes?: number;
  prevCardHash?: string;
  signingKey?: string;
}

/**
 * Issue a signed Warden Permit from a trade evaluation. Throws on BLOCK/CLOSE_ONLY
 * (those verdicts authorize nothing) — callers must check `verdictIssuesPermit`.
 */
export function issuePermit(input: IssuePermitInput): WardenPermit {
  const { evaluation: e, intent, nowIso } = input;
  if (!verdictIssuesPermit(e.verdict)) {
    throw new Error(`verdict ${e.verdict} issues no permit`);
  }
  const expiryMin = input.expiryMinutes ?? DEFAULT_PERMIT_EXPIRY_MIN[e.verdict];
  const expiresAt = new Date(new Date(nowIso).getTime() + expiryMin * 60_000).toISOString();
  const permitId = `WARDEN-${intent.asset.toUpperCase()}-${yyyymmdd(nowIso)}-${String(input.seq).padStart(4, "0")}`;

  const body: WardenPermitBody = {
    subject: "trade_permit",
    permit_id: permitId,
    created_at: nowIso,
    expires_at: expiresAt,
    asset: intent.asset,
    direction: intent.direction,
    original_command: intent.rawCommand,
    approved_order: e.approvedOrder ?? null,
    verdict: e.verdict,
    risk_flags: e.riskFlags,
    gates_passed: e.gatesPassed,
    gates_failed: e.gatesFailed,
    modification_reason: e.modificationReason,
    trigger_source: intent.triggerSource,
    price_at_issue: input.priceAtIssue,
    max_price_drift_pct: input.maxPriceDriftPct ?? 1.0,
    hedge_leg: e.hedgeLeg ?? null,
  };

  return sealCard(body, {
    ...(input.prevCardHash ? { prevCardHash: input.prevCardHash } : {}),
    ...(input.signingKey ? { signingKey: input.signingKey } : {}),
  });
}

/** Single-use registry. A permit may be consumed exactly once. */
export class PermitStore {
  private readonly consumed = new Set<string>();
  private readonly known = new Map<string, WardenPermit>();

  register(permit: WardenPermit): void {
    this.known.set(permit.permit_id, permit);
  }
  get(permitId: string): WardenPermit | undefined {
    return this.known.get(permitId);
  }
  isConsumed(permitId: string): boolean {
    return this.consumed.has(permitId);
  }
  /** Mark consumed. Returns false if it was already consumed (replay). */
  consume(permitId: string): boolean {
    if (this.consumed.has(permitId)) return false;
    this.consumed.add(permitId);
    return true;
  }
}

export type PermitRefusal =
  | "signature_invalid"
  | "hash_mismatch"
  | "expired"
  | "already_consumed"
  | "verdict_not_executable"
  | "price_drift"
  | "action_mismatch"
  | "gate_flipped";

export interface ValidatePermitInput {
  permit: WardenPermit;
  store: PermitStore;
  currentPrice: number;
  nowIso: string;
  /** The exact action the executor was asked to perform. */
  requestedAction: TradeIntent["direction"];
  signingKey?: string;
  /** Optional re-check: a gate that has flipped since issuance invalidates the permit. */
  gateFlipped?: boolean;
}

export interface PermitValidation {
  ok: boolean;
  reason?: PermitRefusal;
  detail?: string;
  priceDriftPct?: number;
}

/**
 * Independently validate a permit at EXECUTION time, in strict order. This is the
 * check the executor runs before any (paper) order — it does not consume the
 * permit; the executor consumes it only after this passes.
 */
export function validatePermitForExecution(input: ValidatePermitInput): PermitValidation {
  const { permit, store, currentPrice } = input;

  // 1. Signature + body integrity (independent of how the permit was delivered).
  const v = verifyCard(permit, input.signingKey ? { signingKey: input.signingKey } : {});
  if (!v.ok) {
    return {
      ok: false,
      reason: v.reason === "hash_mismatch" ? "hash_mismatch" : "signature_invalid",
      detail: v.detail,
    };
  }

  // 2. Expiry.
  if (input.nowIso > permit.expires_at) {
    return { ok: false, reason: "expired", detail: `now ${input.nowIso} > expiry ${permit.expires_at}` };
  }

  // 3. Single-use.
  if (store.isConsumed(permit.permit_id)) {
    return { ok: false, reason: "already_consumed", detail: permit.permit_id };
  }

  // 4. The verdict must actually authorize execution.
  if (!verdictIsExecutable(permit.verdict)) {
    return { ok: false, reason: "verdict_not_executable", detail: `verdict ${permit.verdict}` };
  }

  // 5. The requested action must match the permitted one exactly.
  if (input.requestedAction !== permit.direction) {
    return {
      ok: false, reason: "action_mismatch",
      detail: `requested ${input.requestedAction} != permitted ${permit.direction}`,
    };
  }

  // 6. Market-state binding: price must be within the drift band.
  const drift = permit.price_at_issue > 0
    ? Math.abs((currentPrice - permit.price_at_issue) / permit.price_at_issue) * 100
    : 0;
  if (drift > permit.max_price_drift_pct) {
    return {
      ok: false, reason: "price_drift",
      detail: `drift ${drift.toFixed(2)}% > ${permit.max_price_drift_pct}%`,
      priceDriftPct: Number(drift.toFixed(4)),
    };
  }

  // 7. A gate that flipped since issuance (staleness/spread) invalidates the permit.
  if (input.gateFlipped) {
    return { ok: false, reason: "gate_flipped", detail: "a binding gate flipped since issuance" };
  }

  return { ok: true, priceDriftPct: Number(drift.toFixed(4)) };
}
