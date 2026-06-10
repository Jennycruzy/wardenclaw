/**
 * Bitget paper-side risk gate (§3.4 Bitget-specific gates).
 *
 * Distinct from the BSC Risk Constitution (which enforces spot-only, chain
 * pinning, eligible contracts). These gates protect the paper book: no
 * first-spike entry, no sentiment/technical conflict, no oversized single-stock
 * exposure, no entry into a hostile index, no trade on a stale feed or without a
 * paper-fill source. The reactor already enforces most of these; this is the
 * final deterministic veto before a paper fill is written.
 */

import { BitgetRejectCode } from "./types.js";
import type { ReactorDecision } from "./reactor.js";

export interface PaperRiskCandidate {
  decision: ReactorDecision;
  /** Current single-stock exposure as a portfolio fraction (0..1). */
  currentExposurePct: number;
  maxSingleStockPct: number;
  indexSupport: number;
  minIndexSupport: number;
  feedStale: boolean;
  /** The paper-fill source label; absent/empty blocks the trade. */
  paperFillSource?: string;
}

export interface PaperRiskResult {
  approved: boolean;
  rejectCode?: string;
  reasons: string[];
  passedGates: string[];
}

export function evaluatePaperRiskGate(c: PaperRiskCandidate): PaperRiskResult {
  const passedGates: string[] = [];
  const reject = (rejectCode: string, reason: string): PaperRiskResult => ({
    approved: false,
    rejectCode,
    reasons: [reason],
    passedGates,
  });

  if (c.feedStale) {
    return reject(BitgetRejectCode.STALE_FEED, "price feed stale");
  }
  passedGates.push("feed_fresh");

  if (!c.paperFillSource) {
    return reject(BitgetRejectCode.PAPER_FILL_SOURCE_MISSING, "no paper-fill source");
  }
  passedGates.push("paper_fill_source");

  // The reactor must have approved an entry.
  if (c.decision.action !== "enter_long") {
    return reject(
      c.decision.rejectCode ?? BitgetRejectCode.LOW_SCORE,
      c.decision.reason[0] ?? "reactor did not approve an entry",
    );
  }
  passedGates.push("reactor_entry");

  if (c.indexSupport < c.minIndexSupport) {
    return reject(BitgetRejectCode.INDEX_HOSTILE, "index support hostile");
  }
  passedGates.push("index_support");

  if (c.currentExposurePct >= c.maxSingleStockPct) {
    return reject(BitgetRejectCode.OVERSIZED_EXPOSURE, "single-stock exposure at cap");
  }
  passedGates.push("exposure");

  return { approved: true, reasons: ["all Bitget paper gates passed"], passedGates };
}
