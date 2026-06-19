/**
 * StrategyCompilerAgent wiring for the Bitget reactor (§4.4 / §10.1 steps 1–2).
 *
 * Compiles the natural-language strategy into deterministic strategy JSON via
 * the core compiler: the configured LLM proposes the structure, every risk
 * number is clamped to the hard caps afterwards, and with no LLM available the
 * deterministic manual strategy below is used instead — so the agent always
 * runs with a real compiled strategy, never an empty placeholder. The compiled
 * risk limits are applied back onto the agent config so they actually bind.
 */

import {
  compileStrategy,
  loadPrompt,
  renderPrompt,
  DEFAULT_RISK_CONFIG,
  type CompiledStrategy,
  type LlmProvider,
  type RiskConfig,
} from "@wardenclaw/core";
import { TRADEABLE_XSTOCKS } from "./universe.js";
import type { ReactorConfig } from "./reactor.js";
import { DEFAULT_BITGET_AGENT_CONFIG } from "./agents.js";

export interface CompileBitgetStrategyInput {
  naturalLanguageIntent: string;
  reactor: ReactorConfig;
  /** Modeled paper slippage / informational net-edge margin from agent config. */
  netEdgeMinBps?: number;
  perTradeRiskPct?: number;
  stopAtrMultiple?: number;
  /** The configured LLM provider; a DisabledProvider falls back to manual. */
  provider?: LlmProvider;
  /**
   * Tightened clamp config to compile under, e.g. the Warden-adjusted caps from a
   * Restricted Playbook Shield verdict. When set it REPLACES the reactor-derived
   * config, so the compiler (and its manual fallback) clamp to the lowered numbers.
   */
  riskConfigOverride?: RiskConfig;
}

export interface CompileBitgetStrategyResult {
  strategy: CompiledStrategy;
  source: "llm" | "manual";
  clamped: string[];
}

/** The hard caps the compiler clamps against, derived from the reactor config. */
export function bitgetRiskConfig(input: CompileBitgetStrategyInput): RiskConfig {
  return {
    ...DEFAULT_RISK_CONFIG,
    maxPositionPct: input.reactor.maxSingleStockPct * 100,
    maxConcurrentPositions: 1,
    perTradeRiskPct: input.perTradeRiskPct ?? DEFAULT_BITGET_AGENT_CONFIG.perTradeRiskPct,
    stopAtrMultiple: input.stopAtrMultiple ?? DEFAULT_BITGET_AGENT_CONFIG.stopAtrMultiple,
    netEdgeMinBps: input.netEdgeMinBps ?? DEFAULT_BITGET_AGENT_CONFIG.netEdgeMinBps,
  };
}

/**
 * The deterministic manual strategy used when the LLM is disabled/unavailable.
 * It states exactly what the reactor enforces in code, so "manual mode" is an
 * honest description of the running system, not a degraded guess.
 */
export function manualBitgetStrategy(
  input: CompileBitgetStrategyInput,
  config: RiskConfig,
): CompiledStrategy {
  const r = input.reactor;
  return {
    universe: TRADEABLE_XSTOCKS.map((s) => s.display),
    catalysts: ["earnings", "major_news", "sentiment_shock", "volatility_shock"],
    entryRules: [
      `shock: |return| ≥ ${(r.shock.minMagnitudePct * 100).toFixed(1)}% over ${r.shock.windowBars} bars on ≥ ${r.shock.minVolumeRatio}× volume`,
      "never enter the first volatility spike",
      `wait ${r.cooldownBars}-bar post-event cooldown, then require continuation`,
      "sentiment and technical direction must agree when news is present",
      `index (QQQ/SPY) support ≥ ${r.minIndexSupport}`,
      `deterministic score ≥ ${r.minEntryScore}`,
    ],
    exitRules: [
      "volatility stop (ATR-derived, recorded at entry)",
      ...(r.takeProfitPct !== undefined
        ? [`take profit at +${(r.takeProfitPct * 100).toFixed(1)}%`]
        : []),
      ...(r.sentimentExitConfidence !== undefined
        ? [
            `exit if sentiment reverses (negative event ≥ ${(r.sentimentExitConfidence * 100).toFixed(0)}% confidence)`,
          ]
        : []),
      ...(r.maxHoldBars !== undefined ? [`time exit after ${r.maxHoldBars} bars`] : []),
    ],
    riskLimits: {
      maxPositionPct: config.maxPositionPct,
      perTradeRiskPct: config.perTradeRiskPct,
      maxConcurrentPositions: config.maxConcurrentPositions,
      maxDailyTrades: config.maxTradesPerDay,
      stopAtrMultiple: config.stopAtrMultiple,
      maxSlippageBps: config.maxSlippageBps,
      netEdgeMinBps: config.netEdgeMinBps,
    },
    allowedActions: ["watch", "enter_long", "exit", "hold"],
    noTradeConditions: [
      "first volatility spike",
      "stale market data feed",
      "hostile index support",
      "sentiment/technical conflict",
      "unverified rumor",
      "single-stock exposure at cap",
    ],
    validationMode: "paper",
  };
}

/** Compile the NL strategy (LLM proposes, deterministic clamps; manual fallback). */
export async function compileBitgetStrategy(
  input: CompileBitgetStrategyInput,
): Promise<CompileBitgetStrategyResult> {
  const config = input.riskConfigOverride ?? bitgetRiskConfig(input);
  const manual = manualBitgetStrategy(input, config);
  const userPrompt = renderPrompt(loadPrompt("strategyCompiler.user.md"), {
    NATURAL_LANGUAGE_INTENT: input.naturalLanguageIntent,
    DEFAULT_MAX_POSITION_PCT: String(config.maxPositionPct),
    DEFAULT_PER_TRADE_RISK_PCT: String(config.perTradeRiskPct),
    DEFAULT_MAX_CONCURRENT_POSITIONS: String(config.maxConcurrentPositions),
    DEFAULT_MAX_DAILY_TRADES: String(config.maxTradesPerDay),
    DEFAULT_STOP_ATR_MULTIPLE: String(config.stopAtrMultiple),
    DEFAULT_MAX_SLIPPAGE_BPS: String(config.maxSlippageBps),
    DEFAULT_NET_EDGE_MIN_BPS: String(config.netEdgeMinBps),
    DEFAULT_VALIDATION_MODE: "paper",
  });
  return compileStrategy({
    naturalLanguageIntent: input.naturalLanguageIntent,
    config,
    ...(input.provider ? { provider: input.provider } : {}),
    systemPrompt: loadPrompt("strategyCompiler.system.md"),
    userPrompt,
    manualStrategy: manual,
    validationMode: "paper",
  });
}
