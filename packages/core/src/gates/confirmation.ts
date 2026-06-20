/** Confirmation gate: post-news volume/candle confirmation missing → DELAY. */
import { type GateResult, type MarketContext, hit, ok } from "./shared.js";

export function gateConfirmation(ctx: MarketContext): GateResult {
  // Confirmation only required when a recent news shock is in play.
  if (ctx.newsShockAgeMin !== undefined && !ctx.confirmationPresent) {
    return hit("confirmation", "delay", false, true, "post-news confirmation missing — delay until a confirmation candle");
  }
  return ok("confirmation", ctx.confirmationPresent, true, "confirmation present or not required");
}
