/** News first-spike gate: command within N min of a news shock → DELAY past the spike. */
import { type GateResult, type MarketContext, type TradePermitConfig, hit, ok } from "./shared.js";

export function gateNewsFirstSpike(ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  if (ctx.newsShockAgeMin !== undefined && ctx.newsShockAgeMin < cfg.newsFirstSpikeMinutes) {
    return hit("news_first_spike", "delay", ctx.newsShockAgeMin, cfg.newsFirstSpikeMinutes,
      `command ${ctx.newsShockAgeMin}min into a news shock (< ${cfg.newsFirstSpikeMinutes}min) — delay past the first spike`);
  }
  return ok("news_first_spike", ctx.newsShockAgeMin ?? "none", cfg.newsFirstSpikeMinutes, "no fresh first-spike");
}
