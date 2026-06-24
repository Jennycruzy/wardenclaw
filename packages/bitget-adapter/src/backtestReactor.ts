/**
 * Backtest wrapper that runs the reactor's shock/cooldown logic through the
 * shared core backtester, so a Bitget backtest reflects the same first-spike
 * rejection and cooldown the live paper agent applies. Friction is informational
 * on the Bitget side (no real gas), but the net-edge filter still runs.
 */

import { runBacktest, type Bar, type BacktestResult, type SignalFn } from "@wardenclaw/core";
import type { BitgetCandle } from "./types.js";
import {
  detectShock,
  DEFAULT_REACTOR_CONFIG,
  reactorConfigFromEnv,
  type ReactorConfig,
} from "./reactor.js";

export interface ReactorBacktestConfig {
  reactor: ReactorConfig;
  startingCapitalUsd: number;
  perTradeRiskPct: number;
  stopAtrMultiple: number;
  maxPositionPct: number;
  netEdgeMinBps: number;
  slippageBps: number;
}

export const DEFAULT_REACTOR_BACKTEST_CONFIG: ReactorBacktestConfig = {
  reactor: DEFAULT_REACTOR_CONFIG,
  startingCapitalUsd: 10_000,
  perTradeRiskPct: 3,
  stopAtrMultiple: 1.5,
  maxPositionPct: 50,
  netEdgeMinBps: 15,
  slippageBps: 8,
};

/**
 * Backtest config that uses the SAME shock/cooldown thresholds the live paper
 * agent runs on (BITGET_SHOCK_* etc.), so the backtest reflects the deployed
 * behavior instead of the stricter hard-coded defaults. Backtest-only sizing and
 * friction knobs are env-overridable too, falling back to the defaults above.
 */
export function reactorBacktestConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReactorBacktestConfig {
  const num = (v: string | undefined, fallback: number): number => {
    if (v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const d = DEFAULT_REACTOR_BACKTEST_CONFIG;
  return {
    reactor: reactorConfigFromEnv(env),
    startingCapitalUsd: num(env.BITGET_BACKTEST_CAPITAL_USD, d.startingCapitalUsd),
    perTradeRiskPct: num(env.BITGET_PER_TRADE_RISK_PCT, d.perTradeRiskPct),
    stopAtrMultiple: num(env.BITGET_STOP_ATR_MULTIPLE, d.stopAtrMultiple),
    maxPositionPct: num(env.BITGET_MAX_POSITION_PCT, d.maxPositionPct),
    netEdgeMinBps: num(env.BITGET_NET_EDGE_MIN_BPS, d.netEdgeMinBps),
    slippageBps: num(env.BITGET_SLIPPAGE_BPS, d.slippageBps),
  };
}

/** Convert candles to the core backtester's Bar shape (price + atrPct). */
export function candlesToBars(candles: BitgetCandle[], atrPeriod = 14): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < candles.length; i++) {
    const window = candles.slice(Math.max(0, i - atrPeriod), i + 1);
    let trSum = 0;
    let count = 0;
    for (let j = 1; j < window.length; j++) {
      const cur = window[j]!;
      const prev = window[j - 1]!;
      trSum += Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close),
      );
      count++;
    }
    const c = candles[i]!;
    const atr = count > 0 && c.close > 0 ? trSum / count / c.close : 0.01;
    bars.push({ time: c.time, price: c.close, atrPct: atr });
  }
  return bars;
}

/**
 * Build a SignalFn that arms on a shock, waits out the cooldown, then signals a
 * continuation entry. It tracks shock state across bars via a closure, and
 * mirrors the live agent's exit policy: the backtester enforces the volatility
 * stop, while the profit target and max-hold time exit are signaled here.
 *
 * `bump` (optional) is called once for every flat bar that does NOT produce an
 * entry candidate, with a code describing why — so the backtest report can show
 * the real skip funnel (no-shock / cooldown / wrong-direction / low-volume)
 * instead of only the economic gate rejections recorded by the core backtester.
 * It is purely observational and never changes which bars trade.
 */
export function reactorSignalFn(
  candles: BitgetCandle[],
  cfg: ReactorBacktestConfig,
  bump?: (code: string) => void,
): SignalFn {
  let barsSinceShock: number | null = null;
  let armedMagnitudePct = 0;
  let pendingEntryPrice: number | null = null;
  let entryPrice: number | null = null;
  let heldBars = 0;
  const takeProfitPct = cfg.reactor.takeProfitPct ?? DEFAULT_REACTOR_CONFIG.takeProfitPct!;
  const maxHoldBars = cfg.reactor.maxHoldBars ?? DEFAULT_REACTOR_CONFIG.maxHoldBars!;
  return (bar, index, hasPosition): ReturnType<SignalFn> => {
    const upTo = candles.slice(0, index + 1);
    const shock = detectShock(upTo, cfg.reactor.shock);

    if (barsSinceShock !== null) barsSinceShock += 1;
    // Arm (or re-arm) on a fresh up-shock, capturing its magnitude for later.
    if (shock.isShock && shock.direction === "up") {
      barsSinceShock = 0;
      armedMagnitudePct = shock.magnitudePct;
    }

    if (hasPosition) {
      // Entry filled on the bar that signaled it; adopt that price once.
      if (entryPrice === null) entryPrice = pendingEntryPrice ?? bar.price;
      heldBars += 1;
      if (bar.price >= entryPrice * (1 + takeProfitPct) || heldBars >= maxHoldBars) {
        entryPrice = null;
        pendingEntryPrice = null;
        heldBars = 0;
        return { score: 0, expectedMoveBps: 0, exit: true };
      }
      return null;
    }
    // No position (flat, or the backtester's stop closed it): reset hold state.
    entryPrice = null;
    heldBars = 0;

    // Wait out the cooldown; the spike bar itself is never entered.
    if (barsSinceShock === null || barsSinceShock < cfg.reactor.cooldownBars) {
      if (bump) {
        if (barsSinceShock !== null) {
          // Armed on an earlier up-shock; just waiting out the cooldown window.
          bump("SKIP_COOLDOWN");
        } else if (shock.isShock && shock.direction === "down") {
          // A qualifying shock fired, but downward — the reactor is long-only.
          bump("SKIP_DOWN_SHOCK");
        } else if (shock.magnitudePct >= cfg.reactor.shock.minMagnitudePct) {
          // Move was big enough but the volume confirmation fell short.
          bump("SKIP_LOW_VOLUME");
        } else {
          // The bulk of quiet bars: price move below the shock magnitude bar.
          bump("SKIP_SUB_MAGNITUDE");
        }
      }
      return null;
    }

    // Confirmation: enter the continuation using the ARMED shock magnitude (the
    // current bar is typically no longer a shock once volume normalizes).
    const expectedMoveBps = Math.round(armedMagnitudePct * 10_000 * 0.4);
    // Consume the armed shock so we don't re-enter every bar.
    barsSinceShock = null;
    armedMagnitudePct = 0;
    pendingEntryPrice = bar.price;
    return { score: 70, expectedMoveBps };
  };
}

export function backtestReactor(
  candles: BitgetCandle[],
  cfg: ReactorBacktestConfig = DEFAULT_REACTOR_BACKTEST_CONFIG,
): BacktestResult {
  const bars = candlesToBars(candles);
  // Skip codes recorded by the signal fn (no-shock/cooldown funnel) live
  // alongside the economic gate rejections (REJECT_*) the core backtester
  // records, so the report's `rejections` map shows the full skip funnel.
  const skips: Record<string, number> = {};
  const bumpSkip = (code: string) => {
    skips[code] = (skips[code] ?? 0) + 1;
  };
  const result = runBacktest(bars, reactorSignalFn(candles, cfg, bumpSkip), {
    startingCapitalUsd: cfg.startingCapitalUsd,
    perTradeRiskPct: cfg.perTradeRiskPct,
    stopAtrMultiple: cfg.stopAtrMultiple,
    maxPositionPct: cfg.maxPositionPct,
    netEdgeMinBps: cfg.netEdgeMinBps,
    frictionBudgetBps: 100_000, // informational on Bitget; do not block on friction
    scoringSimCostBps: 0,
    gasPerLegUsd: 0,
    slippageBps: cfg.slippageBps,
    lpFeeBps: 0,
    safetyBufferBps: 0,
  });
  return { ...result, rejections: { ...skips, ...result.rejections } };
}
