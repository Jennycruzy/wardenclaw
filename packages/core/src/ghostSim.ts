/**
 * Ghost simulation — computed counterfactuals, never narrated numbers.
 *
 * Replays an order against an ACTUAL historical price path (real Bitget candles
 * cached into fixtures) and computes, deterministically: the liquidation price,
 * whether liquidation would have triggered, the max drawdown, and the PnL path.
 * Used to show the ORIGINAL command vs the Warden-adjusted order side by side —
 * the figures are the format; every value is computed here from the candles.
 */

export interface SimCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SimOrder {
  /** "long" or "short". */
  side: "long" | "short";
  notionalUsd: number;
  leverage: number;
  entryPrice: number;
}

export interface GhostSimConfig {
  maintenanceMarginRate: number;
}

export const DEFAULT_GHOST_SIM_CONFIG: GhostSimConfig = { maintenanceMarginRate: 0.005 };

export interface GhostResult {
  side: "long" | "short";
  entryPrice: number;
  exposureUsd: number;
  leverage: number;
  liquidationPrice: number;
  liquidated: boolean;
  liquidatedAt?: string;
  /** Worst adverse price reached over the path. */
  worstPrice: number;
  /** Max drawdown of position equity over the path (fraction, 0..1). */
  maxDrawdownPct: number;
  /** Final PnL as a fraction of the margin posted, and in USD. */
  finalPnlPct: number;
  finalPnlUsd: number;
}

/** Liquidation price for a leveraged position (long falls, short rises). */
export function liquidationPrice(order: SimOrder, maintenanceMarginRate: number): number {
  if (order.leverage <= 1) {
    // Spot: a long can only go to zero; a short has no margin liquidation here.
    return order.side === "long" ? 0 : Number.POSITIVE_INFINITY;
  }
  const frac = 1 / order.leverage - maintenanceMarginRate;
  return order.side === "long"
    ? order.entryPrice * (1 - frac)
    : order.entryPrice * (1 + frac);
}

/** Position equity (margin + PnL) at a given price. */
function equityAt(order: SimOrder, price: number): number {
  const margin = order.notionalUsd; // margin posted (notional is the at-risk capital)
  const move = (price - order.entryPrice) / order.entryPrice;
  const dir = order.side === "long" ? 1 : -1;
  return margin * (1 + order.leverage * dir * move);
}

/** Simulate an order over a real candle path. */
export function ghostSimulate(
  order: SimOrder,
  candles: SimCandle[],
  cfg: GhostSimConfig = DEFAULT_GHOST_SIM_CONFIG,
): GhostResult {
  const liq = liquidationPrice(order, cfg.maintenanceMarginRate);
  const margin = order.notionalUsd;
  let peakEquity = margin;
  let maxDrawdown = 0;
  let worstPrice = order.entryPrice;
  let liquidated = false;
  let liquidatedAt: string | undefined;
  let lastPrice = order.entryPrice;

  for (const c of candles) {
    // Adverse extreme within the candle (long cares about the low, short the high).
    const adverse = order.side === "long" ? c.low : c.high;
    if (order.side === "long") worstPrice = Math.min(worstPrice, c.low);
    else worstPrice = Math.max(worstPrice, c.high);

    if (!liquidated) {
      const wouldLiquidate = order.side === "long" ? adverse <= liq : adverse >= liq;
      if (wouldLiquidate && order.leverage > 1) {
        liquidated = true;
        liquidatedAt = c.time;
        maxDrawdown = 1; // total loss of margin
        break;
      }
      const eqAdverse = equityAt(order, adverse);
      peakEquity = Math.max(peakEquity, equityAt(order, c.close));
      const dd = (peakEquity - eqAdverse) / peakEquity;
      maxDrawdown = Math.max(maxDrawdown, dd);
    }
    lastPrice = c.close;
  }

  const finalEquity = liquidated ? 0 : equityAt(order, lastPrice);
  const finalPnlUsd = finalEquity - margin;
  const finalPnlPct = margin > 0 ? finalPnlUsd / margin : 0;

  return {
    side: order.side,
    entryPrice: order.entryPrice,
    exposureUsd: order.notionalUsd * order.leverage,
    leverage: order.leverage,
    liquidationPrice: Number(liq.toFixed(6)),
    liquidated,
    ...(liquidatedAt ? { liquidatedAt } : {}),
    worstPrice: Number(worstPrice.toFixed(6)),
    maxDrawdownPct: Number(maxDrawdown.toFixed(6)),
    finalPnlPct: Number(finalPnlPct.toFixed(6)),
    finalPnlUsd: Number(finalPnlUsd.toFixed(4)),
  };
}

export interface GhostComparison {
  original: GhostResult;
  wardenAdjusted: GhostResult;
  /** USD of drawdown avoided by the adjustment (original maxDD$ − adjusted maxDD$). */
  drawdownAvoidedUsd: number;
  liquidationAvoided: boolean;
}

/** Compare the original command vs the Warden-adjusted order over the same path. */
export function ghostCompare(
  original: SimOrder,
  wardenAdjusted: SimOrder,
  candles: SimCandle[],
  cfg: GhostSimConfig = DEFAULT_GHOST_SIM_CONFIG,
): GhostComparison {
  const o = ghostSimulate(original, candles, cfg);
  const w = ghostSimulate(wardenAdjusted, candles, cfg);
  const oDdUsd = o.maxDrawdownPct * original.notionalUsd;
  const wDdUsd = w.maxDrawdownPct * wardenAdjusted.notionalUsd;
  return {
    original: o,
    wardenAdjusted: w,
    drawdownAvoidedUsd: Number((oDdUsd - wDdUsd).toFixed(4)),
    liquidationAvoided: o.liquidated && !w.liquidated,
  };
}
