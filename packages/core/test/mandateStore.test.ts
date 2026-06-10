import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendMandate, readMandates } from "../src/mandateStore.js";
import type { SignalMandate } from "../src/types.js";

function sampleMandate(id: string): SignalMandate {
  return {
    id,
    venue: "bitget",
    mode: "paper",
    executionType: "paper",
    createdAt: "2026-06-01T00:00:00Z",
    strategyId: "s",
    naturalLanguageIntent: "test",
    compiledStrategy: {},
    asset: "NVDAx",
    assetType: "xstock",
    action: "watch",
    perception: { source: "test", marketData: {} },
    decision: { signalFamily: "catalyst", tradeScore: 0, regime: "r", reason: [] },
    economics: {
      frictionBps: 0,
      realFrictionBps: 0,
      simulatedCostBps: 0,
      expectedMoveBps: 0,
      netEdgePassed: false,
    },
    risk: { approved: false, maxPositionPct: 50, riskClass: "blocked", survivalMode: false },
    execution: { adapter: "internal_paper_engine", status: "not_submitted" },
    watchdog: { armed: false, triggers: [], actionsTaken: [] },
    proofAnchors: {},
    audit: { jsonlPath: "x", eventHash: "h", replayable: true },
  };
}

describe("mandateStore", () => {
  it("round-trips mandates and validates on read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runeclaw-store-"));
    const path = join(dir, "mandates.jsonl");
    try {
      await appendMandate(path, sampleMandate("a"));
      await appendMandate(path, sampleMandate("b"));
      const all = await readMandates(path);
      expect(all.map((m) => m.id)).toEqual(["a", "b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] for a missing file", async () => {
    expect(await readMandates("/nonexistent/path.jsonl")).toEqual([]);
  });

  it("refuses to persist a malformed mandate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runeclaw-store-"));
    const path = join(dir, "m.jsonl");
    try {
      // @ts-expect-error intentionally malformed
      await expect(appendMandate(path, { id: "x" })).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
