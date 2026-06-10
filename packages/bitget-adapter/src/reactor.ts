/**
 * The earnings/news-shock continuation reactor with post-event cooldown.
 *
 * The agent does NOT buy headlines. The flow is deterministic:
 *   1. Detect an earnings/news/volatility shock from real price/volume.
 *   2. Reject entry on the spike bar itself (no first-spike chasing).
 *   3. Wait for a post-event cooldown to confirm continuation.
 *   4. Require sentiment and technical direction to agree (when news is present).
 *   5. Require index (QQQ/SPY) support.
 *   6. Score the setup; only a high enough score becomes an entry.
 *
 * This module is pure — it maps real perception to a decision. Sizing, paper
 * execution, and audit live in the agent layer.
 */

import { scoreBitget, type BitgetScoreInputs } from "@runeclaw/core";
import type { BitgetCandle } from "./types.js";
import { BitgetRejectCode } from "./types.js";

export interface ShockConfig {
  /** Bars over which the shock return is measured. */
  windowBars: number;
  /** |return| over the window to qualify as a shock, as a fraction (0.04 = 4%). */
  minMagnitudePct: number;
  /** Current-bar volume vs. trailing average to qualify, as a multiple. */
  minVolumeRatio: number;
}

export const DEFAULT_SHOCK_CONFIG: ShockConfig = {
  windowBars: 3,
  minMagnitudePct: 0.04,
  minVolumeRatio: 1.8,
};

export interface ShockDetection {
  isShock: boolean;
  magnitudePct: number;
  volumeRatio: number;
  direction: "up" | "down" | "none";
}

/**
 * Detect a shock in the most recent bar of an ascending candle series. The
 * window return is measured from `windowBars` ago to the latest close; the
 * volume ratio compares the latest volume to the trailing average.
 */
export function detectShock(bars: BitgetCandle[], cfg: ShockConfig = DEFAULT_SHOCK_CONFIG): ShockDetection {
  if (bars.length <= cfg.windowBars) {
    return { isShock: false, magnitudePct: 0, volumeRatio: 0, direction: "none" };
  }
  const latest = bars[bars.length - 1]!;
  const past = bars[bars.length - 1 - cfg.windowBars]!;
  const ret = (latest.close - past.close) / past.close;
  const magnitudePct = Math.abs(ret);

  const trailing = bars.slice(-1 - cfg.windowBars, -1);
  const avgVol = trailing.reduce((s, b) => s + b.volume, 0) / Math.max(1, trailing.length);
  const volumeRatio = avgVol > 0 ? latest.volume / avgVol : 0;

  const isShock = magnitudePct >= cfg.minMagnitudePct && volumeRatio >= cfg.minVolumeRatio;
  const direction = !isShock ? "none" : ret > 0 ? "up" : "down";
  return { isShock, magnitudePct, volumeRatio, direction };
}

export interface ReactorConfig {
  shock: ShockConfig;
  /** Bars to wait after the shock bar before an entry may be considered. */
  cooldownBars: number;
  /** Minimum index support (0..1) below which entries are blocked. */
  minIndexSupport: number;
  /** Bitget score (0..100) required to enter. */
  minEntryScore: number;
  /** Maximum portfolio fraction a single xStock may occupy (0..1). */
  maxSingleStockPct: number;
}

export const DEFAULT_REACTOR_CONFIG: ReactorConfig = {
  shock: DEFAULT_SHOCK_CONFIG,
  cooldownBars: 2,
  minIndexSupport: 0.4,
  minEntryScore: 65,
  maxSingleStockPct: 0.5,
};

export interface ClassifiedEvent {
  /** From the news/sentiment classifier (LLM over REAL article text). */
  direction: "positive" | "negative" | "neutral" | "mixed" | "unknown";
  confidence: number;
  tradeRelevance: "high" | "medium" | "low";
  riskFlags: string[];
}

export interface ReactorInput {
  /** Real ascending candle series for the asset. */
  bars: BitgetCandle[];
  /**
   * Bars elapsed since the shock that armed this setup, or null if there is no
   * active armed shock. 0 means the shock just printed on the latest bar.
   */
  barsSinceShock: number | null;
  /**
   * The shock that armed this setup, captured when it first printed. The caller
   * tracks it across cycles; at confirmation time the spike has already passed,
   * so its magnitude/direction must come from here, not a fresh detection.
   */
  armedShock?: ShockDetection;
  /** Optional classified event from real news; absent when Agent Hub is down. */
  event?: ClassifiedEvent;
  /** Technical direction confirmation derived from real price structure. */
  technicalDirection: "up" | "down" | "neutral";
  /** QQQ/SPY support, 0 (hostile) .. 1 (supportive). */
  indexSupport: number;
  /** Current single-stock exposure as a portfolio fraction (0..1). */
  currentExposurePct: number;
  /** Whether the feeding market data is stale (blocks entries). */
  feedStale: boolean;
  cfg?: ReactorConfig;
}

export interface ReactorDecision {
  action: "enter_long" | "reject" | "wait";
  reason: string[];
  rejectCode?: string;
  score?: number;
  /** Expected continuation move in bps, derived from shock magnitude + score. */
  expectedMoveBps?: number;
  direction?: "up" | "down" | "none";
}

/** Map a technical direction string to a normalized [0,1] confirmation. */
function technicalConfirmation(
  shockDir: "up" | "down" | "none",
  techDir: "up" | "down" | "neutral",
): number {
  if (shockDir === "none" || techDir === "neutral") return 0.5;
  return shockDir === techDir ? 1 : 0;
}

/** Map a classified event to a normalized [0,1] sentiment in the shock direction. */
function sentimentAlignment(
  shockDir: "up" | "down" | "none",
  event?: ClassifiedEvent,
): { value: number; conflict: boolean } {
  if (!event || event.direction === "unknown" || event.direction === "neutral") {
    return { value: 0.5, conflict: false };
  }
  const bullish = event.direction === "positive";
  const bearish = event.direction === "negative";
  if (shockDir === "up" && bearish) return { value: 0, conflict: true };
  if (shockDir === "down" && bullish) return { value: 0, conflict: true };
  if (event.direction === "mixed") return { value: 0.5, conflict: false };
  return { value: 0.5 + 0.5 * event.confidence, conflict: false };
}

export function evaluateReactor(input: ReactorInput): ReactorDecision {
  const cfg = input.cfg ?? DEFAULT_REACTOR_CONFIG;

  if (input.feedStale) {
    return { action: "reject", reason: ["market data feed is stale"], rejectCode: BitgetRejectCode.STALE_FEED };
  }

  const shock = detectShock(input.bars, cfg.shock);

  // No active shock and nothing armed → nothing to do.
  if (input.barsSinceShock === null) {
    if (!shock.isShock) {
      return { action: "wait", reason: ["no shock detected"], rejectCode: BitgetRejectCode.NO_SHOCK };
    }
    // A fresh shock just printed; it is armed but not yet tradeable.
    return {
      action: "reject",
      reason: ["shock just printed — avoiding the first spike, arming cooldown"],
      rejectCode: BitgetRejectCode.FIRST_SPIKE,
      direction: shock.direction,
    };
  }

  // Spike bar itself: never enter.
  if (input.barsSinceShock === 0) {
    return {
      action: "reject",
      reason: ["first spike bar — entry forbidden"],
      rejectCode: BitgetRejectCode.FIRST_SPIKE,
      direction: shock.direction,
    };
  }

  // Still inside the post-event cooldown.
  if (input.barsSinceShock < cfg.cooldownBars) {
    return {
      action: "wait",
      reason: [`post-event cooldown ${input.barsSinceShock}/${cfg.cooldownBars}`],
      rejectCode: BitgetRejectCode.POST_EVENT_COOLDOWN,
      direction: shock.direction,
    };
  }

  // Confirmation phase. Use the armed shock (captured at spike time) for the
  // operative magnitude/direction; the current bar may no longer be a shock.
  const eff = input.armedShock ?? shock;
  const dir = eff.direction !== "none" ? eff.direction : "up";

  // Event must be clear enough when present.
  if (input.event && input.event.tradeRelevance === "low" && input.event.riskFlags.includes("rumor")) {
    return {
      action: "reject",
      reason: ["event is an unverified rumor with low trade relevance"],
      rejectCode: BitgetRejectCode.EVENT_UNCLEAR,
      direction: dir,
    };
  }

  const sentiment = sentimentAlignment(dir, input.event);
  if (sentiment.conflict) {
    return {
      action: "reject",
      reason: ["news/sentiment direction conflicts with the price shock"],
      rejectCode: BitgetRejectCode.SENTIMENT_CONFLICT,
      direction: dir,
    };
  }

  // Index support gate.
  if (input.indexSupport < cfg.minIndexSupport) {
    return {
      action: "reject",
      reason: [`index support ${input.indexSupport.toFixed(2)} < ${cfg.minIndexSupport}`],
      rejectCode: BitgetRejectCode.INDEX_HOSTILE,
      direction: dir,
    };
  }

  // Oversized single-stock exposure gate.
  if (input.currentExposurePct >= cfg.maxSingleStockPct) {
    return {
      action: "reject",
      reason: [`single-stock exposure ${(input.currentExposurePct * 100).toFixed(0)}% at cap`],
      rejectCode: BitgetRejectCode.OVERSIZED_EXPOSURE,
      direction: dir,
    };
  }

  // Score the setup deterministically.
  const tech = technicalConfirmation(dir, input.technicalDirection);
  // Volatility cooldown component: rewards having waited out the spike.
  const cooldownComponent = Math.min(1, input.barsSinceShock / (cfg.cooldownBars + 2));
  const inputs: BitgetScoreInputs = {
    earningsNewsShockQuality: Math.min(1, eff.magnitudePct / (cfg.shock.minMagnitudePct * 2)),
    sentimentDirection: sentiment.value,
    technicalConfirmation: tech,
    volatilityCooldown: cooldownComponent,
    indexSupport: Math.min(1, input.indexSupport),
    riskState: 0.7,
  };
  const score = scoreBitget(inputs);

  if (score < cfg.minEntryScore) {
    return {
      action: "reject",
      reason: [`score ${score} < entry threshold ${cfg.minEntryScore}`],
      rejectCode: BitgetRejectCode.LOW_SCORE,
      score,
      direction: dir,
    };
  }

  // Expected continuation move: a fraction of the shock magnitude, scaled by score.
  const expectedMoveBps = Math.round(
    eff.magnitudePct * 10_000 * 0.4 * (score / 100),
  );

  return {
    action: "enter_long",
    reason: [
      `confirmed continuation after ${input.barsSinceShock}-bar cooldown`,
      `score ${score}, shock ${(eff.magnitudePct * 100).toFixed(1)}%`,
    ],
    score,
    expectedMoveBps,
    direction: dir,
  };
}
