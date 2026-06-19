/**
 * Trade-Permit Engine — checkpoint 2 of the command firewall.
 *
 * Audits each TRADE command (already parsed into a structured intent by the LLM
 * layer — parsing only, never risk) through ten deterministic gates and resolves
 * exactly one of SIX verdicts. No seventh. The LLM never decides risk here.
 *
 *   APPROVE     — passes all required gates; executes as requested.
 *   REDUCE      — idea valid, command too aggressive; the engine REWRITES the order
 *                 (smaller size, lower leverage, stricter type) and approves that.
 *   DELAY       — not rejected, not now; returns a concrete recheck condition.
 *   HEDGE       — approved only with an ENFORCED protective leg (atomic bundle).
 *   BLOCK       — fails a major gate; nothing executes.
 *   CLOSE_ONLY  — account survival mode: only risk-reducing actions are permitted.
 *
 * Every gate returns {gate, passed, value, threshold, effect, reason}. All
 * thresholds live in TradePermitConfig. Verdict precedence (most severe first):
 *   CLOSE_ONLY(context) > BLOCK > DELAY > HEDGE > REDUCE > APPROVE.
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

const ok = (gate: string, value: GateResult["value"], threshold: GateResult["threshold"], reason: string): GateResult =>
  ({ gate, passed: true, value, threshold, effect: "none", reason });

const hit = (
  gate: string,
  effect: GateEffect,
  value: GateResult["value"],
  threshold: GateResult["threshold"],
  reason: string,
): GateResult => ({ gate, passed: false, value, threshold, effect, reason });

const isIncrease = (d: TradeDirection): boolean => d === "long" || d === "short";

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

// ---- the ten gates (one function each) ----------------------------------------

export function gateDataStaleness(ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  if (ctx.feedAgeSec > cfg.feedMaxAgeSec) {
    return hit("data_staleness", "block", ctx.feedAgeSec, cfg.feedMaxAgeSec, "required feed is stale — fail-closed");
  }
  return ok("data_staleness", ctx.feedAgeSec, cfg.feedMaxAgeSec, "feeds fresh");
}

export function gateKnownAsset(ctx: MarketContext): GateResult {
  if (!ctx.knownAsset) return hit("known_asset", "block", false, true, "unknown asset — fail-closed");
  return ok("known_asset", true, true, "asset in verified universe");
}

export function gateEarningsWindow(intent: TradeIntent, ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  const h = ctx.earningsWithinHours;
  if (h === undefined || h > cfg.earningsWindowHours) {
    return ok("earnings_window", h ?? "none", `±${cfg.earningsWindowHours}h`, "outside earnings window");
  }
  if (intent.leverage > cfg.earningsBlockLeverage) {
    return hit("earnings_window", "block", `${h}h @ ${intent.leverage}x`, `>${cfg.earningsBlockLeverage}x in window`,
      `within ±${cfg.earningsWindowHours}h of earnings at ${intent.leverage}x — blocked`);
  }
  return hit("earnings_window", "reduce", `${h}h`, `±${cfg.earningsWindowHours}h`,
    `within ±${cfg.earningsWindowHours}h of earnings — reduce exposure`);
}

export function gateVolatilityRegime(ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  if (ctx.volPctile > cfg.volHighPctile) {
    return hit("volatility_regime", "reduce", ctx.volPctile, cfg.volHighPctile,
      `volatility ${(ctx.volPctile * 100).toFixed(0)}th pct > ${(cfg.volHighPctile * 100).toFixed(0)}th — reduce ≥50%, cap leverage`);
  }
  return ok("volatility_regime", ctx.volPctile, cfg.volHighPctile, "volatility normal");
}

export function gateSpreadSlippage(ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  if (ctx.spreadBps > cfg.spreadMaxBps) {
    return hit("spread_slippage", "delay", ctx.spreadBps, cfg.spreadMaxBps,
      `spread ${ctx.spreadBps}bps > ${cfg.spreadMaxBps}bps — delay for liquidity`);
  }
  return ok("spread_slippage", ctx.spreadBps, cfg.spreadMaxBps, "spread normal");
}

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

export function gateConfirmation(ctx: MarketContext): GateResult {
  // Confirmation only required when a recent news shock is in play.
  if (ctx.newsShockAgeMin !== undefined && !ctx.confirmationPresent) {
    return hit("confirmation", "delay", false, true, "post-news confirmation missing — delay until a confirmation candle");
  }
  return ok("confirmation", ctx.confirmationPresent, true, "confirmation present or not required");
}

export function gateNewsFirstSpike(ctx: MarketContext, cfg: TradePermitConfig): GateResult {
  if (ctx.newsShockAgeMin !== undefined && ctx.newsShockAgeMin < cfg.newsFirstSpikeMinutes) {
    return hit("news_first_spike", "delay", ctx.newsShockAgeMin, cfg.newsFirstSpikeMinutes,
      `command ${ctx.newsShockAgeMin}min into a news shock (< ${cfg.newsFirstSpikeMinutes}min) — delay past the first spike`);
  }
  return ok("news_first_spike", ctx.newsShockAgeMin ?? "none", cfg.newsFirstSpikeMinutes, "no fresh first-spike");
}

export function gateMarketSession(ctx: MarketContext): GateResult {
  // Session is informational and feeds the premium gate; it never blocks alone.
  return ok("market_session", ctx.marketOpen ? "open" : "closed", "NYSE hours",
    ctx.marketOpen ? "US market open" : "US market closed — premium gate tightened");
}

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

export function gateBtcCorrelation(intent: TradeIntent, ctx: MarketContext): GateResult {
  if (isIncrease(intent.direction) && ctx.btcCorrelated && ctx.btcRealizedVolRising) {
    return hit("btc_correlation", "hedge", "correlated + BTC vol rising", "hedge required",
      "BTC-correlated asset with BTC realized vol rising — hedge required");
  }
  return ok("btc_correlation", ctx.btcCorrelated ? "correlated" : "uncorrelated", "hedge if BTC vol rising", "no hedge trigger");
}

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

export interface ApprovedOrder {
  asset: string;
  direction: TradeDirection;
  notionalUsd: number;
  leverage: number;
  orderType: "market" | "limit";
  priceBandPct?: number;
}

export interface HedgeLeg {
  asset: string;
  direction: "short";
  notionalUsd: number;
  reason: string;
}

export interface TradePermitEvaluation {
  verdict: TradeVerdict;
  gates: GateResult[];
  gatesPassed: string[];
  gatesFailed: string[];
  riskFlags: string[];
  /** The order the engine will actually permit (rewritten for REDUCE/HEDGE). */
  approvedOrder?: ApprovedOrder;
  /** Enforced protective leg for HEDGE (atomic bundle in the executor). */
  hedgeLeg?: HedgeLeg;
  /** Concrete recheck condition for DELAY. */
  recheckCondition?: string;
  modificationReason: string[];
}

/** Resolve the six-way verdict from the gate results, rewriting the order as needed. */
export function evaluateTradePermit(
  intent: TradeIntent,
  ctx: MarketContext,
  cfg: TradePermitConfig = DEFAULT_TRADE_PERMIT_CONFIG,
): TradePermitEvaluation {
  const gates = runTradeGates(intent, ctx, cfg);
  const failed = gates.filter((g) => !g.passed);
  const gatesPassed = gates.filter((g) => g.passed).map((g) => g.gate);
  const gatesFailed = failed.map((g) => g.gate);
  const riskFlags = failed.map((g) => `${g.gate}:${g.effect}`);
  const reasons = failed.map((g) => g.reason);

  const has = (e: GateEffect) => failed.some((g) => g.effect === e);

  // CLOSE-ONLY (account survival): exposure-increasing commands are refused.
  if (ctx.closeOnlyActive && isIncrease(intent.direction)) {
    return {
      verdict: "CLOSE_ONLY", gates, gatesPassed, gatesFailed,
      riskFlags: [...riskFlags, "close_only:exposure_increase_blocked"],
      modificationReason: ["account in CLOSE-ONLY survival mode — only reduce/close/cancel permitted"],
    };
  }

  // BLOCK dominates.
  if (has("block")) {
    return { verdict: "BLOCK", gates, gatesPassed, gatesFailed, riskFlags, modificationReason: reasons };
  }

  // DELAY: not now.
  if (has("delay")) {
    const delayGate = failed.find((g) => g.effect === "delay")!;
    return {
      verdict: "DELAY", gates, gatesPassed, gatesFailed, riskFlags,
      recheckCondition: recheckFor(delayGate, ctx, cfg),
      modificationReason: reasons,
    };
  }

  // Build the rewritten order shared by HEDGE and REDUCE.
  const { order, mods } = rewriteOrder(intent, ctx, cfg, failed);

  // HEDGE: smaller primary, plus an enforced protective leg (atomic bundle).
  if (has("hedge")) {
    const primary: ApprovedOrder = { ...order, notionalUsd: round2(order.notionalUsd * 0.5) };
    const hedgeLeg: HedgeLeg = {
      asset: intent.asset,
      direction: "short",
      notionalUsd: round2(primary.notionalUsd * 0.5),
      reason: "BTC-vol hedge — atomic protective leg required with the primary long",
    };
    return {
      verdict: "HEDGE", gates, gatesPassed, gatesFailed, riskFlags,
      approvedOrder: primary, hedgeLeg,
      modificationReason: ["primary size −50% (hedge bundle)", ...mods, ...reasons],
    };
  }

  // REDUCE: rewrite and approve.
  if (has("reduce")) {
    return {
      verdict: "REDUCE", gates, gatesPassed, gatesFailed, riskFlags,
      approvedOrder: order, modificationReason: [...mods, ...reasons],
    };
  }

  // APPROVE unchanged.
  return {
    verdict: "APPROVE", gates, gatesPassed, gatesFailed: [], riskFlags: [],
    approvedOrder: {
      asset: intent.asset, direction: intent.direction, notionalUsd: round2(intent.notionalUsd),
      leverage: intent.leverage, orderType: intent.orderType,
    },
    modificationReason: [],
  };
}

function rewriteOrder(
  intent: TradeIntent,
  ctx: MarketContext,
  cfg: TradePermitConfig,
  failed: GateResult[],
): { order: ApprovedOrder; mods: string[] } {
  const mods: string[] = [];
  let notional = intent.notionalUsd;
  let leverage = intent.leverage;
  let orderType = intent.orderType;

  const volHigh = failed.some((g) => g.gate === "volatility_regime");
  const earnings = failed.some((g) => g.gate === "earnings_window");
  const premium = failed.some((g) => g.gate === "premium_discount" && g.effect === "reduce");
  const liq = failed.some((g) => g.gate === "liquidation_distance" && g.effect === "reduce");

  // Leverage caps: hard cap always; volatility tightens further.
  const cap = volHigh ? Math.min(cfg.hardMaxLeverage, cfg.volLeverageCap) : cfg.hardMaxLeverage;
  if (leverage > cap) { mods.push(`leverage ${leverage}x → ${cap}x`); leverage = cap; }

  // Size reductions (apply the most conservative; do not double-stack to zero).
  if (volHigh) { notional *= 1 - cfg.volReduceFraction; mods.push(`size −${cfg.volReduceFraction * 100}% (elevated volatility)`); }
  if (earnings && !volHigh) { notional *= 0.5; mods.push("size −50% (earnings window)"); }
  if (premium) { notional *= 0.75; mods.push("size −25% (xStock premium/discount)"); }
  if (liq) { notional *= 0.5; mods.push("size −50% (liquidation distance)"); }

  // Stricter order type: never widen; market → limit when rewriting.
  if (orderType === "market") { orderType = "limit"; mods.push("order type market → limit"); }

  return {
    order: {
      asset: intent.asset, direction: intent.direction,
      notionalUsd: round2(notional), leverage, orderType, priceBandPct: 0.5,
    },
    mods,
  };
}

function recheckFor(g: GateResult, ctx: MarketContext, cfg: TradePermitConfig): string {
  switch (g.gate) {
    case "news_first_spike":
      return `recheck after the news shock ages past ${cfg.newsFirstSpikeMinutes}min and a confirmation candle prints`;
    case "confirmation":
      return "recheck after a post-news volume/candle confirmation prints";
    case "spread_slippage":
      return `recheck when spread tightens below ${cfg.spreadMaxBps}bps`;
    case "premium_discount":
      return `recheck when the xStock premium/discount converges below ${cfg.premiumDelayPct}%`;
    default:
      return "recheck on the next evaluation cycle";
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
