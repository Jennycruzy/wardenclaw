import { describe, it, expect } from "vitest";
import { parseMandate, safeParseMandate, type SignalMandate } from "../src/index.js";

const valid: SignalMandate = {
  id: "mandate-1",
  venue: "bsc",
  mode: "live",
  executionType: "spot_only",
  createdAt: "2026-06-22T00:00:00Z",
  strategyId: "strat-1",
  naturalLanguageIntent: "Trade momentum and catalysts on the eligible list, spot only.",
  compiledStrategy: { universe: ["CAKE"] },
  asset: "CAKE",
  assetContract: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  assetType: "bep20",
  action: "enter_long",
  perception: { source: "cmc", marketData: { price: 2.1 }, cmcToolsUsed: ["quotes"] },
  decision: { signalFamily: "catalyst", tradeScore: 82, regime: "trending", reason: ["spike"] },
  economics: {
    frictionBps: 120,
    realFrictionBps: 100,
    simulatedCostBps: 20,
    expectedMoveBps: 300,
    netEdgePassed: true,
    stopDistancePct: 0.06,
    stopCoherencePassed: true,
    calibrationVersion: "cal-1",
  },
  risk: {
    approved: true,
    maxPositionPct: 70,
    perTradeRiskPct: 3,
    riskClass: "balanced",
    survivalMode: false,
  },
  execution: { adapter: "twak", status: "filled", txHash: "0xabc" },
  watchdog: { armed: true, triggers: ["stop"], actionsTaken: [] },
  result: { outcome: "open" },
  proofAnchors: { bscTxHash: "0xabc", twakReceipt: "r1" },
  audit: { jsonlPath: "data/audit/m1.jsonl", eventHash: "h1", replayable: true },
};

describe("signal mandate schema", () => {
  it("accepts a well-formed mandate", () => {
    expect(() => parseMandate(valid)).not.toThrow();
  });

  it("rejects an invalid execution type", () => {
    const bad = { ...valid, executionType: "margin" };
    expect(safeParseMandate(bad).success).toBe(false);
  });

  it("rejects a mandate missing the economics block", () => {
    const { economics, ...rest } = valid;
    void economics;
    expect(safeParseMandate(rest).success).toBe(false);
  });

  it("rejects an unknown signal family", () => {
    const bad = { ...valid, decision: { ...valid.decision, signalFamily: "vibes" } };
    expect(safeParseMandate(bad).success).toBe(false);
  });
});
