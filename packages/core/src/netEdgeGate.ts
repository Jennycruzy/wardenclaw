/**
 * Net-Edge Gate.
 *
 * A trade may only execute when its expected move clears total round-trip
 * friction (real + simulated scoring cost) plus a configured margin. Applies to
 * entries and exits alike, except forced safety exits which always pass.
 */

import { RejectCode } from "./types.js";

export interface NetEdgeInputs {
  expectedMoveBps: number;
  frictionBps: number; // round trip, includes simulated scoring cost
  netEdgeMinBps: number;
  /** Forced safety exits bypass the gate. */
  forcedSafetyExit?: boolean;
}

export interface NetEdgeResult {
  passed: boolean;
  /** expectedMove - friction - margin; positive means edge to spare. */
  marginBps: number;
  requiredMoveBps: number;
  rejectCode?: typeof RejectCode.NET_EDGE;
  reason: string;
}

export function evaluateNetEdge(inputs: NetEdgeInputs): NetEdgeResult {
  const requiredMoveBps = inputs.frictionBps + inputs.netEdgeMinBps;
  const marginBps = inputs.expectedMoveBps - requiredMoveBps;

  if (inputs.forcedSafetyExit) {
    return {
      passed: true,
      marginBps,
      requiredMoveBps,
      reason: "forced safety exit — net-edge gate bypassed",
    };
  }

  if (inputs.expectedMoveBps >= requiredMoveBps) {
    return {
      passed: true,
      marginBps,
      requiredMoveBps,
      reason: `expected ${inputs.expectedMoveBps}bps >= required ${requiredMoveBps}bps`,
    };
  }

  return {
    passed: false,
    marginBps,
    requiredMoveBps,
    rejectCode: RejectCode.NET_EDGE,
    reason: `expected ${inputs.expectedMoveBps}bps < required ${requiredMoveBps}bps (friction ${inputs.frictionBps} + margin ${inputs.netEdgeMinBps})`,
  };
}
