/**
 * Deterministic signal scoring. No trade decision is made without a score, and
 * the LLM never produces the score directly. Each component is a normalized value
 * in [0,1]; the weighted sum is scaled to a 0–100 trade score.
 */

export interface ScoreComponent {
  /** Normalized component value in [0,1]. */
  value: number;
  /** Weight as a fraction (weights across a venue sum to 1). */
  weight: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function weightedScore(components: Record<string, ScoreComponent>): number {
  let total = 0;
  let weightSum = 0;
  for (const c of Object.values(components)) {
    total += clamp01(c.value) * c.weight;
    weightSum += c.weight;
  }
  if (Math.abs(weightSum - 1) > 1e-6) {
    throw new Error(`Score weights must sum to 1, got ${weightSum}`);
  }
  return Math.round(total * 100);
}

export interface BscScoreInputs {
  momentum: number; // CMC momentum/trend
  liquiditySafety: number; // liquidity / spread safety
  relativeStrengthVsBnb: number; // signal benchmark only — never implies holding BNB
  sentiment: number; // sentiment / news
  volatilitySafety: number;
  walletRiskState: number;
}

export function scoreBsc(inputs: BscScoreInputs): number {
  return weightedScore({
    momentum: { value: inputs.momentum, weight: 0.35 },
    liquiditySafety: { value: inputs.liquiditySafety, weight: 0.2 },
    relativeStrength: { value: inputs.relativeStrengthVsBnb, weight: 0.15 },
    sentiment: { value: inputs.sentiment, weight: 0.15 },
    volatilitySafety: { value: inputs.volatilitySafety, weight: 0.1 },
    walletRiskState: { value: inputs.walletRiskState, weight: 0.05 },
  });
}

export interface BitgetScoreInputs {
  earningsNewsShockQuality: number;
  sentimentDirection: number;
  technicalConfirmation: number;
  volatilityCooldown: number;
  indexSupport: number; // QQQ/SPY support
  riskState: number;
}

export function scoreBitget(inputs: BitgetScoreInputs): number {
  return weightedScore({
    shock: { value: inputs.earningsNewsShockQuality, weight: 0.25 },
    sentiment: { value: inputs.sentimentDirection, weight: 0.2 },
    technical: { value: inputs.technicalConfirmation, weight: 0.2 },
    cooldown: { value: inputs.volatilityCooldown, weight: 0.15 },
    indexSupport: { value: inputs.indexSupport, weight: 0.1 },
    riskState: { value: inputs.riskState, weight: 0.1 },
  });
}

/** Decision-mode thresholds for the BSC agent. */
export type ScoreMode = "attack" | "scout" | "none";

export function bscScoreMode(score: number): ScoreMode {
  if (score >= 80) return "attack";
  if (score >= 65) return "scout";
  return "none";
}
