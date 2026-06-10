/**
 * Replay engine. Reconstructs what the agent saw, decided, and did for a single
 * mandate from its audit events — including why it traded or skipped, with the
 * reject codes and numbers — plus the integrity check and external truth anchors.
 */

import { verifyChain, type AuditEvent } from "./auditLogger.js";
import type { MandateProofAnchors } from "./types.js";
import { summarizeProof, mergeAnchors } from "./proofAnchors.js";

export interface MandateReplay {
  mandateId: string;
  /** -1 when the chain is intact, else the index of the first broken event. */
  integrityBreakIndex: number;
  integrityOk: boolean;
  stages: Array<{ stage: string; timestamp: string }>;
  perception: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  economics: Record<string, unknown> | null;
  risk: Record<string, unknown> | null;
  execution: Record<string, unknown> | null;
  /** Any reject codes encountered, with the event output that produced them. */
  rejections: Array<{ stage: string; output: Record<string, unknown> }>;
  proof: ReturnType<typeof summarizeProof>;
}

function isRejection(output: Record<string, unknown>): boolean {
  return Object.values(output).some(
    (v) => typeof v === "string" && v.startsWith("REJECT_"),
  );
}

/** Reconstruct a mandate from its ordered audit events. */
export function replayMandate(mandateId: string, events: AuditEvent[]): MandateReplay {
  const mine = events.filter((e) => e.mandateId === mandateId);
  const breakIndex = verifyChain(events);

  const lastByStage = (stage: string): Record<string, unknown> | null => {
    const matching = mine.filter((e) => e.stage === stage);
    return matching.length ? matching[matching.length - 1]!.output : null;
  };

  let anchors: MandateProofAnchors = {};
  for (const e of mine) {
    if (e.proofAnchors) anchors = mergeAnchors(anchors, e.proofAnchors as MandateProofAnchors);
  }

  const rejections = mine
    .filter((e) => isRejection(e.output))
    .map((e) => ({ stage: e.stage, output: e.output }));

  return {
    mandateId,
    integrityBreakIndex: breakIndex,
    integrityOk: breakIndex === -1,
    stages: mine.map((e) => ({ stage: e.stage, timestamp: e.timestamp })),
    perception: lastByStage("perception"),
    decision: lastByStage("decision"),
    economics: lastByStage("economics"),
    risk: lastByStage("risk"),
    execution: lastByStage("execution"),
    rejections,
    proof: summarizeProof(anchors),
  };
}
