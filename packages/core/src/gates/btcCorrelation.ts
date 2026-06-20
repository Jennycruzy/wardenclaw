/** BTC-correlation gate: correlated asset + BTC realized vol rising → HEDGE required. */
import { type GateResult, type MarketContext, type TradeIntent, hit, isIncrease, ok } from "./shared.js";

export function gateBtcCorrelation(intent: TradeIntent, ctx: MarketContext): GateResult {
  if (isIncrease(intent.direction) && ctx.btcCorrelated && ctx.btcRealizedVolRising) {
    return hit("btc_correlation", "hedge", "correlated + BTC vol rising", "hedge required",
      "BTC-correlated asset with BTC realized vol rising — hedge required");
  }
  return ok("btc_correlation", ctx.btcCorrelated ? "correlated" : "uncorrelated", "hedge if BTC vol rising", "no hedge trigger");
}
