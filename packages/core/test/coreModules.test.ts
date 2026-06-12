import { describe, it, expect } from "vitest";
import {
  mergeAnchors,
  summarizeProof,
  hasExternalProof,
  buildCalibrationReport,
} from "../src/index.js";

describe("proof anchors", () => {
  it("merges fragments and ignores empty values", () => {
    const merged = mergeAnchors({ bscTxHash: "0xabc" }, { bscTxHash: "", twakReceipt: "r1" });
    expect(merged.bscTxHash).toBe("0xabc");
    expect(merged.twakReceipt).toBe("r1");
  });

  it("distinguishes external proof from paper-only", () => {
    expect(hasExternalProof({ bscTxHash: "0xabc" })).toBe(true);
    const summary = summarizeProof({ paperFillSource: "internal_paper_engine" });
    expect(summary.paperOnly).toBe(true);
    expect(summary.integrityProof).toBe("JSONL hash chain");
  });
});

describe("calibration report builder", () => {
  it("aggregates real samples into score bands", () => {
    const samples = [
      { score: 82, realizedMoveBps: 200, win: true },
      { score: 85, realizedMoveBps: 240, win: false },
      { score: 70, realizedMoveBps: 60, win: true },
    ];
    const report = buildCalibrationReport(samples, [65, 80], {
      version: "cal-test",
      generatedAt: "2026-06-20T00:00:00Z",
      historyDays: 30,
    });
    const top = report.bands.find((b) => b.minScore === 80)!;
    expect(top.realizedMoveBps).toBeCloseTo(220, 1);
    expect(top.hitRate).toBeCloseTo(0.5, 5);
  });
});
