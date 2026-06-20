/** Data-staleness gate: any required feed older than the cap → BLOCK (fail-closed). */
import { type GateResult, type MarketContext, type TradePermitConfig, hit, ok } from "./shared.js";

export function gateDataStaleness(ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  if (ctx.feedAgeSec > cfg.feedMaxAgeSec) {
    return hit("data_staleness", "block", ctx.feedAgeSec, cfg.feedMaxAgeSec, "required feed is stale — fail-closed");
  }
  return ok("data_staleness", ctx.feedAgeSec, cfg.feedMaxAgeSec, "feeds fresh");
}
