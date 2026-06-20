/**
 * xStock premium/discount gate — the asset-class-native gate.
 *
 * When the tokenized stock trades away from its underlying reference (especially
 * overnight/weekends with no NYSE anchor), abs(premium) over the band → DELAY or
 * REDUCE. This is what makes WardenClaw unmistakably a tokenized-stock firewall.
 */
import {
  type GateResult,
  type MarketContext,
  type TradeIntent,
  type TradePermitConfig,
  hit,
  ok,
  premiumPct,
} from "./shared.js";

export function gatePremiumDiscount(intent: TradeIntent, ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  const prem = premiumPct(ctx.price, ctx.underlyingRefPrice);
  if (prem === undefined) {
    return ok("premium_discount", "no ref", "n/a", "no underlying reference available");
  }
  const abs = Math.abs(prem);
  const reduceAt = ctx.marketOpen ? cfg.premiumReducePct : cfg.closedSessionPremiumReducePct;
  if (abs > cfg.premiumDelayPct) {
    return hit("premium_discount", "delay", Number(prem.toFixed(2)), cfg.premiumDelayPct,
      `xStock ${prem > 0 ? "premium" : "discount"} ${abs.toFixed(2)}% > ${cfg.premiumDelayPct}% — delay until it converges`);
  }
  if (abs > reduceAt) {
    return hit("premium_discount", "reduce", Number(prem.toFixed(2)), reduceAt,
      `xStock ${prem > 0 ? "premium" : "discount"} ${abs.toFixed(2)}% > ${reduceAt}%${ctx.marketOpen ? "" : " (overnight, no NYSE anchor)"} — reduce`);
  }
  return ok("premium_discount", Number(prem.toFixed(2)), reduceAt, "premium/discount within band");
}
