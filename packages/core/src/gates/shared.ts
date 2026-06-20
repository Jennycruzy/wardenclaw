/**
 * Shared gate primitives — types, config, and helpers used by every deterministic
 * gate module in this directory.
 *
 * Each gate lives in its own file (`src/gates/<name>.ts`, one module per gate, per
 * the Trade-Permit Engine spec) and depends only on this module, so a gate can be
 * read, tested, and reasoned about in isolation. `tradePermit.ts` composes them and
 * re-exports these symbols for backward compatibility.
 */

export type TradeVerdict = "APPROVE" | "REDUCE" | "DELAY" | "HEDGE" | "BLOCK" | "CLOSE_ONLY";

/** What a gate pushes the verdict toward. `tighten` folds into REDUCE. */
export type GateEffect = "none" | "reduce" | "delay" | "hedge" | "block";

export type TradeDirection = "long" | "short" | "reduce" | "close" | "cancel";

/** A structured trade command (NL parsed by the LLM layer upstream). */
export interface TradeIntent {
  asset: string;
  direction: TradeDirection;
  notionalUsd: number;
  leverage: number;
  orderType: "market" | "limit";
  limitPrice?: number;
  triggerSource: "human" | "ai_agent";
  rawCommand: string;
}

/** Deterministic gate inputs, each sourced from a declared skill/API (see GATE_TABLE.md). */
export interface MarketContext {
  nowIso: string;
  /** Whether the asset is a known, tradeable universe member. */
  knownAsset: boolean;
  /** Whether the asset trades with the BTC complex (drives the HEDGE gate). */
  btcCorrelated: boolean;
  /** Current xStock mid price. */
  price: number;
  /** Reference/last-close of the underlying equity, for premium/discount. */
  underlyingRefPrice?: number;
  /** Orderbook spread in bps. */
  spreadBps: number;
  /** Realized/ATR volatility percentile over 90d (0..1). */
  volPctile: number;
  /** Hours to the nearest earnings event (absolute); undefined if none near. */
  earningsWithinHours?: number;
  /** Minutes since the last news shock; undefined when no recent shock. */
  newsShockAgeMin?: number;
  /** Whether post-news volume/candle confirmation is present. */
  confirmationPresent: boolean;
  /** NYSE session open? */
  marketOpen: boolean;
  /** BTC realized vol rising (macro-analyst). */
  btcRealizedVolRising: boolean;
  /** Max age (sec) of any required feed — staleness. */
  feedAgeSec: number;
  /** Account-level survival mode set by the close-only watcher. */
  closeOnlyActive?: boolean;
}

export interface TradePermitConfig {
  earningsWindowHours: number;
  earningsBlockLeverage: number;
  volHighPctile: number;
  volReduceFraction: number;
  volLeverageCap: number;
  spreadMaxBps: number;
  minLiquidationDistancePct: number;
  liqBlockDistancePct: number;
  maintenanceMarginRate: number;
  newsFirstSpikeMinutes: number;
  premiumReducePct: number;
  premiumDelayPct: number;
  feedMaxAgeSec: number;
  hardMaxLeverage: number;
  /** When market is closed, tighten the premium gate to this (lower) threshold. */
  closedSessionPremiumReducePct: number;
}

export const DEFAULT_TRADE_PERMIT_CONFIG: TradePermitConfig = {
  earningsWindowHours: 48,
  earningsBlockLeverage: 2,
  volHighPctile: 0.8,
  volReduceFraction: 0.5,
  volLeverageCap: 2,
  spreadMaxBps: 50,
  minLiquidationDistancePct: 8,
  liqBlockDistancePct: 4,
  maintenanceMarginRate: 0.005,
  newsFirstSpikeMinutes: 15,
  premiumReducePct: 1.5,
  premiumDelayPct: 3,
  feedMaxAgeSec: 60,
  hardMaxLeverage: 3,
  closedSessionPremiumReducePct: 0.75,
};

export interface GateResult {
  gate: string;
  passed: boolean;
  value: number | string | boolean;
  threshold: number | string | boolean;
  effect: GateEffect;
  reason: string;
}

export const ok = (
  gate: string,
  value: GateResult["value"],
  threshold: GateResult["threshold"],
  reason: string,
): GateResult => ({ gate, passed: true, value, threshold, effect: "none", reason });

export const hit = (
  gate: string,
  effect: GateEffect,
  value: GateResult["value"],
  threshold: GateResult["threshold"],
  reason: string,
): GateResult => ({ gate, passed: false, value, threshold, effect, reason });

export const isIncrease = (d: TradeDirection): boolean => d === "long" || d === "short";

/** Liquidation distance (%) for a leveraged long; spot (≤1x) is effectively safe. */
export function liquidationDistancePct(leverage: number, maintenanceMarginRate: number): number {
  if (leverage <= 1) return 100;
  return Math.max(0, (1 / leverage - maintenanceMarginRate) * 100);
}

/** Signed premium/discount (%) of the xStock vs the underlying reference. */
export function premiumPct(price: number, underlyingRefPrice: number | undefined): number | undefined {
  if (underlyingRefPrice === undefined || underlyingRefPrice <= 0) return undefined;
  return ((price - underlyingRefPrice) / underlyingRefPrice) * 100;
}
