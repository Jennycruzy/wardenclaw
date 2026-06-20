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
 *
 * The gates themselves live one-module-per-gate under ./gates/ (per the spec);
 * this module composes them into the six-way verdict and rewrites orders. The gate
 * primitives, types, config, and every gate are re-exported below so existing
 * imports from "@wardenclaw/core" / "./tradePermit.js" keep resolving unchanged.
 */

import {
  DEFAULT_TRADE_PERMIT_CONFIG,
  type GateEffect,
  type GateResult,
  type MarketContext,
  type TradeDirection,
  type TradeIntent,
  type TradePermitConfig,
  type TradeVerdict,
  isIncrease,
  runTradeGates,
} from "./gates/index.js";

// Re-export the gate registry surface (types, config, helpers, all gates,
// runTradeGates) so the package's public API is unchanged by the gate split.
export * from "./gates/index.js";

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
