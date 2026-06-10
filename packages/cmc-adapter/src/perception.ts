/**
 * Turn real CMC signals into the deterministic scoring inputs the core uses.
 *
 * The LLM never sets these; they are computed from CMC quotes, trending, and
 * Fear & Greed. The relative-strength-vs-BNB component is a SIGNAL benchmark only
 * — it never implies holding BNB as a position (§0.1a). Each builder records the
 * tools it consumed so the mandate can attribute its decision.
 */

import type { BscScoreInputs } from "@wardenclaw/core";
import type { CmcQuote, CmcSignal, FearGreed, TrendingToken } from "./types.js";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Normalize a percentage change into [0,1] around a saturating band. */
function normMomentum(pct: number, saturationPct = 8): number {
  return clamp01(0.5 + pct / (2 * saturationPct));
}

/** Liquidity safety from 24h volume relative to a reference floor. */
function liquiditySafety(volume24hUsd: number, floorUsd = 1_000_000): number {
  if (volume24hUsd <= 0) return 0;
  return clamp01(Math.log10(volume24hUsd / floorUsd + 1) / 2);
}

/** Volatility safety: lower 1h churn relative to 24h trend is safer. */
function volatilitySafety(change1h: number): number {
  return clamp01(1 - Math.abs(change1h) / 12);
}

export interface MomentumInputsResult {
  inputs: BscScoreInputs;
  signalFamily: "momentum";
  toolsUsed: string[];
}

/**
 * Momentum-family score inputs for a liquid major vs the BNB benchmark.
 * `bnbChange24h` is the relative-strength reference only.
 */
export function buildMomentumInputs(
  quote: CmcQuote,
  bnbChange24h: number,
  fearGreed: FearGreed,
  walletRiskState: number,
): MomentumInputsResult {
  const relStrength = normMomentum(quote.percentChange24h - bnbChange24h, 10);
  const sentiment = clamp01(fearGreed.value / 100);
  const inputs: BscScoreInputs = {
    momentum: normMomentum(quote.percentChange24h),
    liquiditySafety: liquiditySafety(quote.volume24hUsd),
    relativeStrengthVsBnb: relStrength,
    sentiment,
    volatilitySafety: volatilitySafety(quote.percentChange1h),
    walletRiskState: clamp01(walletRiskState),
  };
  return { inputs, signalFamily: "momentum", toolsUsed: ["quotes", "fear_greed"] };
}

export interface CatalystInputsResult {
  inputs: BscScoreInputs;
  signalFamily: "catalyst";
  toolsUsed: string[];
  trendingRank: number;
}

/**
 * Catalyst-family score inputs for a token surfaced by CMC trending. The
 * short-horizon momentum is weighted by how strongly it is trending.
 */
export function buildCatalystInputs(
  quote: CmcQuote,
  trending: TrendingToken,
  fearGreed: FearGreed,
  walletRiskState: number,
): CatalystInputsResult {
  // A higher trending position lifts the momentum read for catalysts.
  const trendBoost = clamp01(1 - (trending.rank - 1) / 20);
  const inputs: BscScoreInputs = {
    momentum: clamp01(0.5 * normMomentum(quote.percentChange1h, 6) + 0.5 * trendBoost),
    liquiditySafety: liquiditySafety(quote.volume24hUsd),
    relativeStrengthVsBnb: normMomentum(quote.percentChange24h, 12),
    sentiment: clamp01(fearGreed.value / 100),
    volatilitySafety: volatilitySafety(quote.percentChange1h),
    walletRiskState: clamp01(walletRiskState),
  };
  return { inputs, signalFamily: "catalyst", toolsUsed: ["quotes", "trending", "fear_greed"], trendingRank: trending.rank };
}

/** Collect attribution across a set of CMC signals used for one decision. */
export function toolsFromSignals(...signals: Array<CmcSignal<unknown>>): string[] {
  return [...new Set(signals.map((s) => s.tool))];
}
