/**
 * Watchdog (§3.6): deterministic position protection.
 *
 * The watchdog owns every exit decision on an open position. It evaluates the
 * armed triggers against current real perception and returns a named action —
 * the venue adapter executes it (paper book close for Bitget; a live executor
 * would route through its execution layer). Triggers are armed at entry time
 * and recorded on the mandate, so an auditor can see exactly what protection
 * a position carried; every fired trigger is written as a `watchdog`-stage
 * audit event by the caller.
 */

/** The §3.6 action vocabulary. Venue adapters implement the subset they need. */
export type WatchdogAction =
  | "reduce_position"
  | "close_position"
  | "cancel_pending_order"
  | "pause_strategy"
  | "switch_to_survival_mode"
  | "record_no_trade_reason"
  | "attempt_revoke_approvals"
  | "execute_stop_exit";

/** Current state of one open long position. */
export interface WatchdogPositionState {
  entryPrice: number;
  /** Volatility-derived stop recorded at entry. */
  stopPrice: number;
  /** Latest real mid price. */
  currentPrice: number;
  /** Bars the position has been held. */
  heldBars: number;
}

/** Latest classified event for the asset (from REAL news; absent when none). */
export interface WatchdogEventContext {
  direction: "positive" | "negative" | "neutral" | "mixed" | "unknown";
  confidence: number;
  tradeRelevance: "high" | "medium" | "low";
}

export interface WatchdogConfig {
  /** Profit target as a fraction of entry price (0.015 = +1.5%). */
  takeProfitPct?: number;
  /** Time exit after this many bars. */
  maxHoldBars?: number;
  /**
   * Sentiment-reversal exit: close a long when a classified real-news event
   * turns against it with at least this confidence (and relevance above "low").
   * Disabled when undefined.
   */
  sentimentExitMinConfidence?: number;
}

export interface WatchdogDecision {
  /** Which armed trigger fired. */
  trigger: "volatility_stop" | "take_profit" | "max_hold" | "sentiment_reversal";
  action: WatchdogAction;
  reason: string;
}

/**
 * The trigger names armed for a position under this config, recorded on the
 * mandate's `watchdog.triggers` at entry.
 */
export function armedTriggers(cfg: WatchdogConfig): string[] {
  const triggers = ["volatility_stop"];
  if (cfg.takeProfitPct !== undefined) triggers.push("take_profit");
  if (cfg.sentimentExitMinConfidence !== undefined) triggers.push("sentiment_reversal");
  if (cfg.maxHoldBars !== undefined) triggers.push("max_hold");
  return triggers;
}

/**
 * Evaluate the armed triggers for one open long. Returns the first decision in
 * priority order — the stop is safety and always wins; the profit target beats
 * the sentiment exit when both are true on the same bar (take the better fill);
 * the time exit is last.
 */
export function evaluateWatchdog(
  pos: WatchdogPositionState,
  cfg: WatchdogConfig,
  event?: WatchdogEventContext,
): WatchdogDecision | null {
  if (pos.currentPrice <= pos.stopPrice) {
    return {
      trigger: "volatility_stop",
      action: "execute_stop_exit",
      reason: `volatility stop hit (${pos.currentPrice} ≤ ${pos.stopPrice})`,
    };
  }

  if (
    cfg.takeProfitPct !== undefined &&
    pos.currentPrice >= pos.entryPrice * (1 + cfg.takeProfitPct)
  ) {
    return {
      trigger: "take_profit",
      action: "close_position",
      reason: `profit target +${(cfg.takeProfitPct * 100).toFixed(1)}% reached`,
    };
  }

  if (
    cfg.sentimentExitMinConfidence !== undefined &&
    event &&
    event.direction === "negative" &&
    event.confidence >= cfg.sentimentExitMinConfidence &&
    event.tradeRelevance !== "low"
  ) {
    return {
      trigger: "sentiment_reversal",
      action: "close_position",
      reason:
        `sentiment reversed against the long: negative ` +
        `(${(event.confidence * 100).toFixed(0)}% ≥ ${(cfg.sentimentExitMinConfidence * 100).toFixed(0)}%, ` +
        `relevance ${event.tradeRelevance})`,
    };
  }

  if (cfg.maxHoldBars !== undefined && pos.heldBars >= cfg.maxHoldBars) {
    return {
      trigger: "max_hold",
      action: "close_position",
      reason: `max hold ${cfg.maxHoldBars} bars elapsed`,
    };
  }

  return null;
}
