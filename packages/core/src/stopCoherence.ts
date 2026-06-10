/**
 * Volatility-derived stops and size coherence.
 *
 * Stop distance comes from the pair's recent noise band, never an arbitrary
 * percentage. Position size is then derived from the stop. If the resulting size
 * is so small that friction exceeds budget, the setup is not tradeable at this
 * book size — reject rather than tightening the stop to force a fit.
 */

import { RejectCode } from "./types.js";

export interface StopCoherenceInputs {
  portfolioUsd: number;
  /** Capital available to deploy (excludes the gas reserve). */
  deployableUsd: number;
  perTradeRiskPct: number;
  stopAtrMultiple: number;
  /** Recent ATR for the pair, expressed as a fraction of price (e.g. 0.04 = 4%). */
  recentAtrPct: number;
  maxPositionPct: number;
  /** Optional governor-imposed cap on position size in USD. */
  governorCapUsd?: number;
  /** Round-trip friction budget in bps. */
  frictionBudgetBps: number;
  /**
   * Function returning estimated round-trip friction in bps for a given
   * notional. Lets coherence reuse the live friction model.
   */
  estimateFrictionBps: (notionalUsd: number) => number;
}

export interface StopCoherenceResult {
  passed: boolean;
  stopDistancePct: number;
  positionSizeUsd: number;
  frictionBpsAtSize: number;
  rejectCode?: typeof RejectCode.STOP_COHERENCE;
  reason: string;
}

export function evaluateStopCoherence(inputs: StopCoherenceInputs): StopCoherenceResult {
  if (inputs.recentAtrPct <= 0) {
    throw new Error("evaluateStopCoherence: recentAtrPct must be > 0");
  }

  // Stop distance is the volatility band scaled by the configured multiple.
  const stopDistancePct = inputs.stopAtrMultiple * inputs.recentAtrPct;

  // Size is derived from the stop: risk a fixed % of the book over the stop band.
  const riskUsd = (inputs.perTradeRiskPct / 100) * inputs.portfolioUsd;
  const rawSizeUsd = riskUsd / stopDistancePct;

  const maxByPct = (inputs.maxPositionPct / 100) * inputs.deployableUsd;
  const caps = [rawSizeUsd, maxByPct];
  if (inputs.governorCapUsd !== undefined) caps.push(inputs.governorCapUsd);
  const positionSizeUsd = Math.min(...caps);

  const frictionBpsAtSize = inputs.estimateFrictionBps(positionSizeUsd);

  if (positionSizeUsd <= 0) {
    return {
      passed: false,
      stopDistancePct,
      positionSizeUsd,
      frictionBpsAtSize,
      rejectCode: RejectCode.STOP_COHERENCE,
      reason: "derived position size is non-positive",
    };
  }

  if (frictionBpsAtSize > inputs.frictionBudgetBps) {
    return {
      passed: false,
      stopDistancePct,
      positionSizeUsd,
      frictionBpsAtSize,
      rejectCode: RejectCode.STOP_COHERENCE,
      reason: `volatility stop forces size $${positionSizeUsd.toFixed(2)} where friction ${frictionBpsAtSize.toFixed(1)}bps > budget ${inputs.frictionBudgetBps}bps`,
    };
  }

  return {
    passed: true,
    stopDistancePct,
    positionSizeUsd,
    frictionBpsAtSize,
    reason: `stop ${(stopDistancePct * 100).toFixed(2)}%, size $${positionSizeUsd.toFixed(2)}, friction ${frictionBpsAtSize.toFixed(1)}bps within budget`,
  };
}
