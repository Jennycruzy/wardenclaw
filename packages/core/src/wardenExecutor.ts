/**
 * Sim executor gateway — the ONLY code path that may place a (paper) order.
 *
 * It refuses any order without a permit, then INDEPENDENTLY verifies the permit
 * in strict order (signature → expiry → single-use → price-drift → verdict
 * authorizes this exact action → close-only survival). A HEDGE permit is treated
 * as an ATOMIC two-leg bundle: it executes only if BOTH the primary and the hedge
 * leg are submitted together, and both fill (paper) or neither does — no ordering
 * dependency, no fill polling. Every attempt (accepted or rejected) is logged with
 * a reason; that log is judge-facing evidence.
 *
 * Paper-only: the actual fill function is injected and every fill is labeled paper.
 * The executor never invents a fill and never reaches a real-capital path.
 */

import {
  PermitStore,
  validatePermitForExecution,
  type WardenPermit,
  type PermitRefusal,
} from "./wardenPermit.js";
import type { ApprovedOrder, HedgeLeg, TradeIntent } from "./tradePermit.js";

export interface PaperFill {
  leg: "primary" | "hedge";
  asset: string;
  side: "buy" | "sell";
  notionalUsd: number;
  price: number;
  filledQty: number;
  paper: true;
  source: string;
  timestamp: string;
}

/** Injected paper-fill function. MUST return a labeled paper fill or throw. */
export type PaperFillFn = (
  spec: { leg: "primary" | "hedge"; asset: string; side: "buy" | "sell"; notionalUsd: number },
  price: number,
  nowIso: string,
) => PaperFill;

export type ExecutorReason =
  | "no_permit"
  | PermitRefusal
  | "hedge_bundle_incomplete"
  | "close_only_blocked"
  | "fill_error";

export interface ExecuteRequest {
  permit?: WardenPermit;
  currentPrice: number;
  nowIso: string;
  requestedAction: TradeIntent["direction"];
  /** Which legs the caller submitted — for the atomic HEDGE bundle check. */
  legsSubmitted?: Array<"primary" | "hedge">;
  /** A binding gate that flipped since issuance (staleness/spread). */
  gateFlipped?: boolean;
  closeOnlyActive?: boolean;
}

export interface ExecuteResult {
  accepted: boolean;
  reason?: ExecutorReason;
  detail?: string;
  permitId?: string;
  verdict?: WardenPermit["verdict"];
  fills: PaperFill[];
}

export interface ExecutorAttempt extends ExecuteResult {
  at: string;
  requestedAction: string;
}

const isIncrease = (d: TradeIntent["direction"]): boolean => d === "long" || d === "short";

export class WardenExecutor {
  readonly attempts: ExecutorAttempt[] = [];

  constructor(
    private readonly store: PermitStore,
    private readonly fill: PaperFillFn,
    private readonly opts: { signingKey?: string; onAttempt?: (a: ExecutorAttempt) => void } = {},
  ) {}

  private log(result: ExecuteResult, req: ExecuteRequest): ExecuteResult {
    const attempt: ExecutorAttempt = { ...result, at: req.nowIso, requestedAction: req.requestedAction };
    this.attempts.push(attempt);
    this.opts.onAttempt?.(attempt);
    return result;
  }

  private reject(reason: ExecutorReason, detail: string, req: ExecuteRequest, permit?: WardenPermit): ExecuteResult {
    return this.log(
      { accepted: false, reason, detail, fills: [], ...(permit ? { permitId: permit.permit_id, verdict: permit.verdict } : {}) },
      req,
    );
  }

  /** Attempt a (paper) execution. The single gateway every order must pass through. */
  execute(req: ExecuteRequest): ExecuteResult {
    // 0. No permit, no execution.
    if (!req.permit) return this.reject("no_permit", "no permit presented", req);
    const permit = req.permit;

    // 1–6. Independent permit verification (signature, expiry, single-use, drift, action).
    const v = validatePermitForExecution({
      permit,
      store: this.store,
      currentPrice: req.currentPrice,
      nowIso: req.nowIso,
      requestedAction: req.requestedAction,
      ...(this.opts.signingKey ? { signingKey: this.opts.signingKey } : {}),
      ...(req.gateFlipped ? { gateFlipped: true } : {}),
    });
    if (!v.ok) return this.reject(v.reason!, v.detail ?? "", req, permit);

    // 7. Close-only survival: refuse exposure-increasing actions even with a permit.
    if (req.closeOnlyActive && isIncrease(req.requestedAction)) {
      return this.reject("close_only_blocked", "account in CLOSE-ONLY; exposure increase refused", req, permit);
    }

    const order = permit.approved_order;
    if (!order) return this.reject("verdict_not_executable", "permit carries no order", req, permit);

    // 8. HEDGE is an atomic two-leg bundle: both legs or neither.
    if (permit.verdict === "HEDGE") {
      const legs = req.legsSubmitted ?? [];
      if (!permit.hedge_leg || !legs.includes("primary") || !legs.includes("hedge")) {
        return this.reject(
          "hedge_bundle_incomplete",
          "HEDGE permit requires BOTH the primary and hedge legs submitted together",
          req,
          permit,
        );
      }
    }

    // 9. Consume (single-use) then fill atomically. On any fill error, nothing is recorded.
    const fills: PaperFill[] = [];
    try {
      fills.push(this.fill(
        { leg: "primary", asset: order.asset, side: order.direction === "long" ? "buy" : "sell", notionalUsd: order.notionalUsd },
        req.currentPrice,
        req.nowIso,
      ));
      if (permit.verdict === "HEDGE" && permit.hedge_leg) {
        const h: HedgeLeg = permit.hedge_leg;
        fills.push(this.fill(
          { leg: "hedge", asset: h.asset, side: "sell", notionalUsd: h.notionalUsd },
          req.currentPrice,
          req.nowIso,
        ));
      }
    } catch (err) {
      return this.reject("fill_error", (err as Error).message, req, permit);
    }

    // Commit single-use only after both legs filled.
    this.store.consume(permit.permit_id);
    return this.log(
      { accepted: true, permitId: permit.permit_id, verdict: permit.verdict, fills },
      req,
    );
  }
}

/** A deterministic paper-fill function for demos/tests — labeled paper, never real. */
export function makeDeterministicPaperFill(source = "internal_paper_engine"): PaperFillFn {
  return (spec, price, nowIso) => ({
    leg: spec.leg,
    asset: spec.asset,
    side: spec.side,
    notionalUsd: spec.notionalUsd,
    price,
    filledQty: price > 0 ? Number((spec.notionalUsd / price).toFixed(6)) : 0,
    paper: true,
    source,
    timestamp: nowIso,
  });
}

/** Build a value used to demonstrate tampering in the bypass demo. */
export function tamperPermit(permit: WardenPermit): WardenPermit {
  return { ...permit, approved_order: permit.approved_order ? { ...permit.approved_order, notionalUsd: permit.approved_order.notionalUsd * 100 } : null };
}

export type { ApprovedOrder };
