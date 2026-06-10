import { describe, it, expect } from "vitest";
import {
  scoreBsc,
  scoreBitget,
  bscScoreMode,
  expectedMoveBps,
  edgeEstimate,
  isCalibrationStale,
  type CalibrationReport,
} from "../src/index.js";

describe("signal scorer", () => {
  it("returns a deterministic 0-100 score for BSC", () => {
    const inputs = {
      momentum: 0.9,
      liquiditySafety: 0.8,
      relativeStrengthVsBnb: 0.7,
      sentiment: 0.6,
      volatilitySafety: 0.5,
      walletRiskState: 1,
    };
    const a = scoreBsc(inputs);
    const b = scoreBsc(inputs);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(100);
  });

  it("returns 100 when all components are maxed", () => {
    expect(
      scoreBsc({
        momentum: 1,
        liquiditySafety: 1,
        relativeStrengthVsBnb: 1,
        sentiment: 1,
        volatilitySafety: 1,
        walletRiskState: 1,
      }),
    ).toBe(100);
    expect(
      scoreBitget({
        earningsNewsShockQuality: 1,
        sentimentDirection: 1,
        technicalConfirmation: 1,
        volatilityCooldown: 1,
        indexSupport: 1,
        riskState: 1,
      }),
    ).toBe(100);
  });

  it("maps scores to decision modes", () => {
    expect(bscScoreMode(85)).toBe("attack");
    expect(bscScoreMode(70)).toBe("scout");
    expect(bscScoreMode(40)).toBe("none");
  });
});

describe("edge calibration mapping", () => {
  const report: CalibrationReport = {
    version: "cal-1",
    generatedAt: "2026-06-20T00:00:00Z",
    historyDays: 30,
    bands: [
      { minScore: 65, realizedMoveBps: 80, hitRate: 0.45, realizedVsPredicted: 0.9 },
      { minScore: 80, realizedMoveBps: 220, hitRate: 0.62, realizedVsPredicted: 1.05 },
    ],
  };

  it("maps a high score to the top band's realized move", () => {
    expect(expectedMoveBps(85, report)).toBe(220);
    expect(expectedMoveBps(70, report)).toBe(80);
    expect(expectedMoveBps(50, report)).toBe(0);
  });

  it("derives an edge estimate from hit rate", () => {
    expect(edgeEstimate(85, report)).toBeCloseTo(0.62, 5);
    expect(edgeEstimate(50, report)).toBe(0);
  });

  it("flags stale calibration", () => {
    const now = Date.parse("2026-06-30T00:00:00Z");
    expect(isCalibrationStale(report, now, 7)).toBe(true);
    expect(isCalibrationStale(report, Date.parse("2026-06-22T00:00:00Z"), 7)).toBe(false);
  });
});
