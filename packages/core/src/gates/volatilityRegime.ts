/** Volatility-regime gate: vol above the high percentile → REDUCE size, cap leverage. */
import { type GateResult, type MarketContext, type TradePermitConfig, hit, ok } from "./shared.js";

export function gateVolatilityRegime(ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  if (ctx.volPctile > cfg.volHighPctile) {
    return hit("volatility_regime", "reduce", ctx.volPctile, cfg.volHighPctile,
      `volatility ${(ctx.volPctile * 100).toFixed(0)}th pct > ${(cfg.volHighPctile * 100).toFixed(0)}th — reduce ≥50%, cap leverage`);
  }
  return ok("volatility_regime", ctx.volPctile, cfg.volHighPctile, "volatility normal");
}
