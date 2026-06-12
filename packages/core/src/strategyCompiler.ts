/**
 * Strategy Compiler. Turns a natural-language strategy into deterministic
 * strategy JSON. An LLM may propose the structure, but every risk-relevant number
 * is clamped to the system's hard caps afterwards — so the compiler can never
 * raise risk above configured limits, regardless of what the model (or a
 * malicious prompt) returns. With no LLM available it runs in manual mode.
 */

import { compiledStrategySchema, type CompiledStrategy } from "./llm/schemas.js";
import {
  DisabledProvider,
  LlmDisabledError,
  type LlmProvider,
} from "./llm/provider.js";
import type { RiskConfig } from "./config.js";

export interface CompileStrategyInput {
  naturalLanguageIntent: string;
  config: RiskConfig;
  provider?: LlmProvider;
  /** System/user prompt text (loaded from the prompt files by the caller). */
  systemPrompt: string;
  userPrompt: string;
  /**
   * Used when no LLM is available (disabled mode) or as an explicit override.
   * Must be a full or partial CompiledStrategy; it is validated and clamped too.
   */
  manualStrategy?: unknown;
  validationMode?: CompiledStrategy["validationMode"];
}

export interface CompileStrategyResult {
  strategy: CompiledStrategy;
  /** "llm" when a provider produced it, "manual" when the fallback was used. */
  source: "llm" | "manual";
  clamped: string[];
  /** Why the LLM path was not used (set only when source is "manual"). */
  fallbackReason?: string;
}

/** Clamp every risk number to the safe side of the configured hard caps. */
function clampRiskLimits(
  proposed: CompiledStrategy["riskLimits"],
  config: RiskConfig,
): { limits: CompiledStrategy["riskLimits"]; clamped: string[] } {
  const clamped: string[] = [];
  const capDown = (value: number, cap: number, name: string): number => {
    if (value > cap) {
      clamped.push(`${name} ${value} -> ${cap}`);
      return cap;
    }
    return value;
  };
  const floorUp = (value: number, floor: number, name: string): number => {
    if (value < floor) {
      clamped.push(`${name} ${value} -> ${floor}`);
      return floor;
    }
    return value;
  };

  return {
    limits: {
      // Caps: never above the configured maximum.
      maxPositionPct: capDown(proposed.maxPositionPct, config.maxPositionPct, "maxPositionPct"),
      perTradeRiskPct: capDown(proposed.perTradeRiskPct, config.perTradeRiskPct, "perTradeRiskPct"),
      maxConcurrentPositions: capDown(
        proposed.maxConcurrentPositions,
        config.maxConcurrentPositions,
        "maxConcurrentPositions",
      ),
      maxDailyTrades: capDown(proposed.maxDailyTrades, config.maxTradesPerDay, "maxDailyTrades"),
      maxSlippageBps: capDown(proposed.maxSlippageBps, config.maxSlippageBps, "maxSlippageBps"),
      // Floors: never below the configured minimum (more conservative).
      stopAtrMultiple: floorUp(proposed.stopAtrMultiple, config.stopAtrMultiple, "stopAtrMultiple"),
      netEdgeMinBps: floorUp(proposed.netEdgeMinBps, config.netEdgeMinBps, "netEdgeMinBps"),
    },
    clamped,
  };
}

/** Default risk limits from config, used to fill gaps before clamping. */
function defaultRiskLimits(config: RiskConfig): CompiledStrategy["riskLimits"] {
  return {
    maxPositionPct: config.maxPositionPct,
    perTradeRiskPct: config.perTradeRiskPct,
    maxConcurrentPositions: config.maxConcurrentPositions,
    maxDailyTrades: config.maxTradesPerDay,
    stopAtrMultiple: config.stopAtrMultiple,
    maxSlippageBps: config.maxSlippageBps,
    netEdgeMinBps: config.netEdgeMinBps,
  };
}

export async function compileStrategy(
  input: CompileStrategyInput,
): Promise<CompileStrategyResult> {
  const provider = input.provider ?? new DisabledProvider();

  let raw: CompiledStrategy;
  let source: "llm" | "manual";
  let fallbackReason: string | undefined;

  try {
    raw = await provider.generateStructured({
      system: input.systemPrompt,
      user: input.userPrompt,
      schema: compiledStrategySchema,
    });
    source = "llm";
  } catch (err) {
    // Disabled or failed LLM: fall back to a validated manual strategy.
    if (input.manualStrategy === undefined) {
      if (err instanceof LlmDisabledError) throw err;
      throw new LlmDisabledError(
        `LLM unavailable and no manualStrategy provided: ${(err as Error).message}`,
      );
    }
    raw = compiledStrategySchema.parse(input.manualStrategy);
    source = "manual";
    fallbackReason = (err as Error).message;
  }

  // Fill any zero/blank risk limits with config defaults, then clamp to caps.
  const proposed = { ...defaultRiskLimits(input.config), ...raw.riskLimits };
  const { limits, clamped } = clampRiskLimits(proposed, input.config);

  const strategy: CompiledStrategy = {
    ...raw,
    catalysts: raw.catalysts ?? [],
    riskLimits: limits,
    validationMode: input.validationMode ?? raw.validationMode,
  };

  return { strategy, source, clamped, ...(fallbackReason ? { fallbackReason } : {}) };
}
