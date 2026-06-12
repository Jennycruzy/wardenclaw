import { describe, it, expect } from "vitest";
import { DisabledProvider, type LlmProvider } from "@wardenclaw/core";
import {
  compileBitgetStrategy,
  bitgetRiskConfig,
  DEFAULT_REACTOR_CONFIG,
  TRADEABLE_XSTOCKS,
} from "../src/index.js";

const base = { naturalLanguageIntent: "Watch the xStocks.", reactor: DEFAULT_REACTOR_CONFIG };

describe("compileBitgetStrategy", () => {
  it("falls back to the deterministic manual strategy when the LLM is disabled", async () => {
    const result = await compileBitgetStrategy({ ...base, provider: new DisabledProvider() });
    expect(result.source).toBe("manual");
    expect(result.strategy.universe).toEqual(TRADEABLE_XSTOCKS.map((s) => s.display));
    expect(result.strategy.validationMode).toBe("paper");
    expect(result.strategy.entryRules.join(" ")).toContain("never enter the first volatility spike");
    expect(result.strategy.exitRules.join(" ")).toContain("exit if sentiment reverses");
    // Manual limits equal the hard caps exactly — nothing to clamp.
    expect(result.clamped).toEqual([]);
  });

  it("works with no provider at all (unattended deterministic mode)", async () => {
    const result = await compileBitgetStrategy(base);
    expect(result.source).toBe("manual");
  });

  it("clamps an over-cap LLM proposal back to the hard caps", async () => {
    const config = bitgetRiskConfig(base);
    const greedy: LlmProvider = {
      name: "local",
      async generateStructured() {
        return {
          universe: ["NVDAx"],
          catalysts: [],
          entryRules: ["always be buying"],
          exitRules: ["never"],
          riskLimits: {
            maxPositionPct: 100,
            perTradeRiskPct: 50,
            maxConcurrentPositions: 10,
            maxDailyTrades: 99,
            stopAtrMultiple: 0.1,
            maxSlippageBps: 10_000,
            netEdgeMinBps: 0,
          },
          allowedActions: ["enter_long"],
          noTradeConditions: [],
          validationMode: "paper",
        } as never;
      },
    };
    const result = await compileBitgetStrategy({ ...base, provider: greedy });
    expect(result.source).toBe("llm");
    expect(result.clamped.length).toBeGreaterThan(0);
    const limits = result.strategy.riskLimits;
    expect(limits.maxPositionPct).toBeLessThanOrEqual(config.maxPositionPct);
    expect(limits.perTradeRiskPct).toBeLessThanOrEqual(config.perTradeRiskPct);
    expect(limits.maxConcurrentPositions).toBeLessThanOrEqual(config.maxConcurrentPositions);
    expect(limits.maxSlippageBps).toBeLessThanOrEqual(config.maxSlippageBps);
    // Floors: stops/net-edge can only get more conservative, never looser.
    expect(limits.stopAtrMultiple).toBeGreaterThanOrEqual(config.stopAtrMultiple);
    expect(limits.netEdgeMinBps).toBeGreaterThanOrEqual(config.netEdgeMinBps);
  });
});
