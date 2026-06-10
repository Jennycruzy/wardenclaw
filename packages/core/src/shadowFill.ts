/**
 * Shadow-Fill / MEV & slippage guard.
 *
 * Before signing a live swap, simulate the exact swap against current chain state
 * and compare the simulated output to the output the decision was based on. If
 * the deviation exceeds tolerance, abort — likely thin liquidity, a moved price,
 * or sandwich risk.
 */

import { RejectCode } from "./types.js";

export interface ShadowFillInputs {
  /** Output amount the decision assumed (from the earlier quote). */
  expectedOut: number;
  /** Output amount from simulating against current chain state now. */
  simulatedOut: number;
  toleranceBps: number;
}

export interface ShadowFillResult {
  passed: boolean;
  deviationBps: number;
  rejectCode?: typeof RejectCode.SHADOW_FILL;
  reason: string;
}

export function evaluateShadowFill(inputs: ShadowFillInputs): ShadowFillResult {
  if (inputs.expectedOut <= 0) {
    throw new Error("evaluateShadowFill: expectedOut must be > 0");
  }

  // Signed deviation: negative means we'd receive less than expected (the risk).
  const deviationBps =
    ((inputs.simulatedOut - inputs.expectedOut) / inputs.expectedOut) * 10_000;

  // Only adverse deviation beyond tolerance aborts; receiving more is fine.
  if (deviationBps < -inputs.toleranceBps) {
    return {
      passed: false,
      deviationBps,
      rejectCode: RejectCode.SHADOW_FILL,
      reason: `simulated output ${deviationBps.toFixed(1)}bps below expected, beyond ${inputs.toleranceBps}bps tolerance`,
    };
  }

  return {
    passed: true,
    deviationBps,
    reason: `simulated output within tolerance (${deviationBps.toFixed(1)}bps)`,
  };
}
