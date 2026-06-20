/** Spread/slippage gate: orderbook spread above the cap → DELAY for liquidity. */
import { type GateResult, type MarketContext, type TradePermitConfig, hit, ok } from "./shared.js";

export function gateSpreadSlippage(ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  if (ctx.spreadBps > cfg.spreadMaxBps) {
    return hit("spread_slippage", "delay", ctx.spreadBps, cfg.spreadMaxBps,
      `spread ${ctx.spreadBps}bps > ${cfg.spreadMaxBps}bps — delay for liquidity`);
  }
  return ok("spread_slippage", ctx.spreadBps, cfg.spreadMaxBps, "spread normal");
}
