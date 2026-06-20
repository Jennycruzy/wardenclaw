/** Earnings-window gate: within ±Nh of earnings → BLOCK if over-levered, else REDUCE. */
import { type GateResult, type MarketContext, type TradeIntent, type TradePermitConfig, hit, ok } from "./shared.js";

export function gateEarningsWindow(intent: TradeIntent, ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  const h = ctx.earningsWithinHours;
  if (h === undefined || h > cfg.earningsWindowHours) {
    return ok("earnings_window", h ?? "none", `±${cfg.earningsWindowHours}h`, "outside earnings window");
  }
  if (intent.leverage > cfg.earningsBlockLeverage) {
    return hit("earnings_window", "block", `${h}h @ ${intent.leverage}x`, `>${cfg.earningsBlockLeverage}x in window`,
      `within ±${cfg.earningsWindowHours}h of earnings at ${intent.leverage}x — blocked`);
  }
  return hit("earnings_window", "reduce", `${h}h`, `±${cfg.earningsWindowHours}h`,
    `within ±${cfg.earningsWindowHours}h of earnings — reduce exposure`);
}
