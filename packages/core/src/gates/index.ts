/**
 * Deterministic gate registry — one module per gate (see `docs/GATE_TABLE.md`).
 *
 * Every gate is a pure function returning a {gate, passed, value, threshold,
 * effect, reason} GateResult. Verdicts come ONLY from these gates; the LLM layer
 * never decides risk. `runTradeGates` runs them in the declared order.
 */
import type { GateResult, MarketContext, TradeIntent, TradePermitConfig } from "./shared.js";
import { gateDataStaleness } from "./dataStaleness.js";
import { gateKnownAsset } from "./knownAsset.js";
import { gateEarningsWindow } from "./earningsWindow.js";
import { gateVolatilityRegime } from "./volatilityRegime.js";
import { gateSpreadSlippage } from "./spreadSlippage.js";
import { gateLiquidationDistance } from "./liquidationDistance.js";
import { gateConfirmation } from "./confirmation.js";
import { gateNewsFirstSpike } from "./newsFirstSpike.js";
import { gateMarketSession } from "./marketSession.js";
import { gatePremiumDiscount } from "./premiumDiscount.js";
import { gateBtcCorrelation } from "./btcCorrelation.js";

export * from "./shared.js";
export { gateDataStaleness } from "./dataStaleness.js";
export { gateKnownAsset } from "./knownAsset.js";
export { gateEarningsWindow } from "./earningsWindow.js";
export { gateVolatilityRegime } from "./volatilityRegime.js";
export { gateSpreadSlippage } from "./spreadSlippage.js";
export { gateLiquidationDistance } from "./liquidationDistance.js";
export { gateConfirmation } from "./confirmation.js";
export { gateNewsFirstSpike } from "./newsFirstSpike.js";
export { gateMarketSession } from "./marketSession.js";
export { gatePremiumDiscount } from "./premiumDiscount.js";
export { gateBtcCorrelation } from "./btcCorrelation.js";

/** Run all ten gates in declared order. */
export function runTradeGates(intent: TradeIntent, ctx: MarketContext, cfg: TradePermitConfig): GateResult[] {
  return [
    gateDataStaleness(ctx, cfg),
    gateKnownAsset(ctx),
    gateEarningsWindow(intent, ctx, cfg),
    gateVolatilityRegime(ctx, cfg),
    gateSpreadSlippage(ctx, cfg),
    gateLiquidationDistance(intent, cfg),
    gateConfirmation(ctx),
    gateNewsFirstSpike(ctx, cfg),
    gateMarketSession(ctx),
    gatePremiumDiscount(intent, ctx, cfg),
    gateBtcCorrelation(intent, ctx),
  ];
}
