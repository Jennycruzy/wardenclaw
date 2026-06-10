/**
 * External proof anchors. Hash chaining proves the audit log was not altered;
 * these anchors are what tie a mandate to the outside world (a BSC tx hash, a
 * TWAK receipt, an x402 receipt, CMC request metadata, a paper-fill source).
 * This module merges anchors and summarizes integrity vs. external truth.
 */

import type { MandateProofAnchors } from "./types.js";

/** Merge anchor fragments, later values overriding earlier non-empty ones. */
export function mergeAnchors(
  ...parts: Array<Partial<MandateProofAnchors> | undefined>
): MandateProofAnchors {
  const out: MandateProofAnchors = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [k, v] of Object.entries(part)) {
      if (v !== undefined && v !== "") {
        (out as Record<string, unknown>)[k] = v;
      }
    }
  }
  return out;
}

/** The anchors that represent verifiable external truth (not just integrity). */
const EXTERNAL_TRUTH_KEYS: (keyof MandateProofAnchors)[] = [
  "bscTxHash",
  "twakReceipt",
  "x402Receipt",
  "cmcRequestId",
  "bitgetRequestId",
  "registrationTxHash",
];

export function hasExternalProof(anchors: MandateProofAnchors): boolean {
  return EXTERNAL_TRUTH_KEYS.some((k) => Boolean(anchors[k]));
}

export interface ProofSummary {
  integrityProof: string;
  truthAnchors: string[];
  /** True when only the paper-fill source is present (no real external receipt). */
  paperOnly: boolean;
}

/** Build the display summary the replay dashboard shows. */
export function summarizeProof(anchors: MandateProofAnchors): ProofSummary {
  const truthAnchors: string[] = [];
  for (const k of EXTERNAL_TRUTH_KEYS) {
    const v = anchors[k];
    if (v) truthAnchors.push(`${k}=${v}`);
  }
  if (anchors.paperFillSource) truthAnchors.push(`paperFillSource=${anchors.paperFillSource}`);
  if (anchors.marketDataTimestamp) {
    truthAnchors.push(`marketDataTimestamp=${anchors.marketDataTimestamp}`);
  }

  return {
    integrityProof: "JSONL hash chain",
    truthAnchors,
    paperOnly: !hasExternalProof(anchors) && Boolean(anchors.paperFillSource),
  };
}
