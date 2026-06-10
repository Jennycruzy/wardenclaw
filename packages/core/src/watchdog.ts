/**
 * Watchdog decision logic. Spot markets have no native stop orders, so the
 * watchdog monitors an open position and decides which protective actions to take;
 * the actual signing happens through the execution adapter. This module is pure:
 * it maps a position + market state to a set of intended actions.
 */

export const WatchdogAction = {
  REDUCE_POSITION: "reduce_position",
  CLOSE_POSITION: "close_position",
  CANCEL_PENDING_ORDER: "cancel_pending_order",
  PAUSE_STRATEGY: "pause_strategy",
  SWITCH_TO_SURVIVAL_MODE: "switch_to_survival_mode",
  RECORD_NO_TRADE_REASON: "record_no_trade_reason",
  ATTEMPT_REVOKE_APPROVALS: "attempt_revoke_approvals",
  EXECUTE_STOP_EXIT: "execute_stop_exit",
} as const;
export type WatchdogAction = (typeof WatchdogAction)[keyof typeof WatchdogAction];

export interface WatchdogInputs {
  /** Current mid price of the held asset. */
  currentPrice: number;
  /** The volatility-derived stop price (below entry for a long). */
  stopPrice: number;
  hasOpenPosition: boolean;
  hasPendingOrder: boolean;
  /** Whole-window drawdown so far, in percent. */
  windowDrawdownPct: number;
  softDrawdownPct: number;
  /** Consecutive realized losses. */
  lossStreak: number;
  portfolioValueUsd: number;
  dangerPortfolioValueUsd: number;
  liquidityThinning: boolean;
  cmcSignalFlipped: boolean;
  slippageSpiking: boolean;
}

export interface WatchdogResult {
  actions: WatchdogAction[];
  survivalMode: boolean;
  reasons: string[];
}

export function evaluateWatchdog(input: WatchdogInputs): WatchdogResult {
  const actions = new Set<WatchdogAction>();
  const reasons: string[] = [];
  let survivalMode = false;

  // Volatility-stop enforcement: breach forces an exit (a forced safety exit).
  if (input.hasOpenPosition && input.currentPrice <= input.stopPrice) {
    actions.add(WatchdogAction.EXECUTE_STOP_EXIT);
    reasons.push(`price ${input.currentPrice} <= stop ${input.stopPrice}`);
  }

  // Danger threshold: liquidate to eligible stables and enter survival.
  if (input.portfolioValueUsd <= input.dangerPortfolioValueUsd) {
    survivalMode = true;
    if (input.hasOpenPosition) actions.add(WatchdogAction.CLOSE_POSITION);
    actions.add(WatchdogAction.SWITCH_TO_SURVIVAL_MODE);
    actions.add(WatchdogAction.ATTEMPT_REVOKE_APPROVALS);
    reasons.push("portfolio at/below danger threshold");
  }

  // Soft drawdown or a loss streak: de-risk and arm survival mode.
  if (input.windowDrawdownPct >= input.softDrawdownPct || input.lossStreak >= 2) {
    survivalMode = true;
    actions.add(WatchdogAction.SWITCH_TO_SURVIVAL_MODE);
    if (input.hasOpenPosition) actions.add(WatchdogAction.REDUCE_POSITION);
    reasons.push(
      input.lossStreak >= 2
        ? `loss streak ${input.lossStreak}`
        : `soft drawdown ${input.windowDrawdownPct}% >= ${input.softDrawdownPct}%`,
    );
  }

  // Thesis-break signals: reduce and consider pausing fresh entries.
  if (input.cmcSignalFlipped || input.liquidityThinning || input.slippageSpiking) {
    if (input.hasOpenPosition) actions.add(WatchdogAction.REDUCE_POSITION);
    actions.add(WatchdogAction.PAUSE_STRATEGY);
    if (input.cmcSignalFlipped) reasons.push("CMC signal flipped");
    if (input.liquidityThinning) reasons.push("liquidity thinning");
    if (input.slippageSpiking) reasons.push("slippage spiking");
  }

  // A dangling pending order with no position should be cancelled.
  if (input.hasPendingOrder && !input.hasOpenPosition) {
    actions.add(WatchdogAction.CANCEL_PENDING_ORDER);
    reasons.push("pending order without an open position");
  }

  if (actions.size === 0) {
    actions.add(WatchdogAction.RECORD_NO_TRADE_REASON);
    reasons.push("no protective action required");
  }

  return { actions: [...actions], survivalMode, reasons };
}
