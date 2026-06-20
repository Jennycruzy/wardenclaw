/** Market-session gate: informational; never blocks alone, feeds the premium gate. */
import { type GateResult, type MarketContext, ok } from "./shared.js";

export function gateMarketSession(ctx: MarketContext): GateResult {
  // Session is informational and feeds the premium gate; it never blocks alone.
  return ok("market_session", ctx.marketOpen ? "open" : "closed", "NYSE hours",
    ctx.marketOpen ? "US market open" : "US market closed — premium gate tightened");
}
