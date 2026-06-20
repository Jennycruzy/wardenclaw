/** Liquidation-distance gate: computed distance below thresholds → REDUCE or BLOCK. */
import {
  type GateResult,
  type TradeIntent,
  type TradePermitConfig,
  hit,
  isIncrease,
  liquidationDistancePct,
  ok,
} from "./shared.js";

export function gateLiquidationDistance(intent: TradeIntent, cfg: TradePermitConfig): GateResult {
  if (!isIncrease(intent.direction)) return ok("liquidation_distance", "n/a", `${cfg.minLiquidationDistancePct}%`, "risk-reducing action");
  const dist = liquidationDistancePct(intent.leverage, cfg.maintenanceMarginRate);
  if (dist < cfg.liqBlockDistancePct) {
    return hit("liquidation_distance", "block", Number(dist.toFixed(2)), cfg.liqBlockDistancePct,
      `liquidation distance ${dist.toFixed(1)}% < ${cfg.liqBlockDistancePct}% — blocked`);
  }
  if (dist < cfg.minLiquidationDistancePct) {
    return hit("liquidation_distance", "reduce", Number(dist.toFixed(2)), cfg.minLiquidationDistancePct,
      `liquidation distance ${dist.toFixed(1)}% < ${cfg.minLiquidationDistancePct}% — reduce/deleverage`);
  }
  return ok("liquidation_distance", Number(dist.toFixed(2)), cfg.minLiquidationDistancePct, "liquidation distance safe");
}
