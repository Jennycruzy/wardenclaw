/**
 * Trade-count vs survival precedence (§3.5) and frequency policy (§5.9).
 *
 * The verified minimum is 1 trade/day, 7/week. The best pattern is to make the
 * required daily trade BE a strategic trade when an edge exists; otherwise the
 * sanctioned compliance trade is a stable↔stable Micro-Scout. A negative-edge
 * directional trade is never forced just to satisfy activity.
 */

import type { RiskConfig } from "@runeclaw/core";

export interface ScheduleState {
  tradesToday: number;
  tradesThisWeek: number;
  /** Hours remaining before the current UTC day ends. */
  hoursLeftInDay: number;
  survivalMode: boolean;
  /** A net-edge-positive directional candidate is available this cycle. */
  haveEdgeCandidate: boolean;
  /** Conditions are safe to execute the stable↔stable Micro-Scout. */
  safeToScout: boolean;
}

export type TradePlan = "attack" | "micro_scout" | "hold";

export interface ScheduleDecision {
  plan: TradePlan;
  reason: string;
  /** True when the daily minimum is at risk and the user should be alerted. */
  dailyTradeAtRisk: boolean;
}

export function decideTradePlan(state: ScheduleState, config: RiskConfig): ScheduleDecision {
  const atMaxToday = state.tradesToday >= config.maxTradesPerDay;
  const belowMinToday = state.tradesToday < config.minTradesPerDay;

  // 1. A real edge → take the Attack trade (it also satisfies the daily minimum),
  //    unless we've hit the daily cap.
  if (state.haveEdgeCandidate && !atMaxToday) {
    return {
      plan: "attack",
      reason: "net-edge-positive candidate — strategic trade also satisfies the daily minimum",
      dailyTradeAtRisk: false,
    };
  }

  // 2. No edge. If the daily minimum is still unmet and the day is closing, use
  //    the stable↔stable Micro-Scout (allowed even in survival mode if safe).
  if (belowMinToday) {
    const closing = state.hoursLeftInDay <= config.maxTradesPerDay * 0 + 4; // alert window
    if (closing) {
      if (state.safeToScout) {
        return {
          plan: "micro_scout",
          reason: "daily minimum unmet near day end — stable↔stable Micro-Scout for compliance",
          dailyTradeAtRisk: true,
        };
      }
      return {
        plan: "hold",
        reason: "trade-count risk accepted to avoid unsafe execution — alert the user",
        dailyTradeAtRisk: true,
      };
    }
    // Minimum unmet but the day is not yet closing: wait for a better setup.
    return {
      plan: "hold",
      reason: "daily minimum not yet met; waiting for an edge before falling back to a scout",
      dailyTradeAtRisk: false,
    };
  }

  // 3. Minimum already met (or capped): hold.
  return {
    plan: "hold",
    reason: atMaxToday ? "daily trade cap reached" : "daily minimum already satisfied",
    dailyTradeAtRisk: false,
  };
}
