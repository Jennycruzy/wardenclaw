import { describe, it, expect } from "vitest";
import {
  detectShock,
  evaluateReactor,
  DEFAULT_REACTOR_CONFIG,
  BitgetRejectCode,
  type ShockDetection,
} from "../src/index.js";
import { flatCandles, shockSeries, appendCalm } from "./helpers.js";

const cfg = DEFAULT_REACTOR_CONFIG;
const armedUp: ShockDetection = { isShock: true, magnitudePct: 0.06, volumeRatio: 3, direction: "up" };

describe("detectShock", () => {
  it("detects an up shock with a volume surge", () => {
    const s = detectShock(shockSeries({ shockPct: 0.06, shockVolumeMult: 3 }), cfg.shock);
    expect(s.isShock).toBe(true);
    expect(s.direction).toBe("up");
    expect(s.magnitudePct).toBeGreaterThan(0.04);
  });

  it("ignores a price move without volume", () => {
    const s = detectShock(shockSeries({ shockPct: 0.06, shockVolumeMult: 1 }), cfg.shock);
    expect(s.isShock).toBe(false);
  });

  it("reports no shock on a flat series", () => {
    expect(detectShock(flatCandles(10), cfg.shock).isShock).toBe(false);
  });
});

describe("evaluateReactor", () => {
  it("waits when there is no shock", () => {
    const d = evaluateReactor({
      bars: flatCandles(10),
      barsSinceShock: null,
      technicalDirection: "neutral",
      indexSupport: 0.8,
      currentExposurePct: 0,
      feedStale: false,
    });
    expect(d.action).toBe("wait");
    expect(d.rejectCode).toBe(BitgetRejectCode.NO_SHOCK);
  });

  it("rejects the first spike bar (no chasing)", () => {
    const d = evaluateReactor({
      bars: shockSeries({}),
      barsSinceShock: 0,
      armedShock: armedUp,
      technicalDirection: "up",
      indexSupport: 0.8,
      currentExposurePct: 0,
      feedStale: false,
    });
    expect(d.action).toBe("reject");
    expect(d.rejectCode).toBe(BitgetRejectCode.FIRST_SPIKE);
  });

  it("waits through the post-event cooldown", () => {
    const d = evaluateReactor({
      bars: appendCalm(shockSeries({}), 1),
      barsSinceShock: 1,
      armedShock: armedUp,
      technicalDirection: "up",
      indexSupport: 0.8,
      currentExposurePct: 0,
      feedStale: false,
    });
    expect(d.action).toBe("wait");
    expect(d.rejectCode).toBe(BitgetRejectCode.POST_EVENT_COOLDOWN);
  });

  it("enters after cooldown when confirmed", () => {
    const d = evaluateReactor({
      bars: appendCalm(shockSeries({}), 2),
      barsSinceShock: 2,
      armedShock: armedUp,
      technicalDirection: "up",
      indexSupport: 0.8,
      currentExposurePct: 0,
      feedStale: false,
    });
    expect(d.action).toBe("enter_long");
    expect(d.score).toBeGreaterThanOrEqual(cfg.minEntryScore);
    expect(d.expectedMoveBps).toBeGreaterThan(0);
  });

  it("rejects when sentiment conflicts with the price shock", () => {
    const d = evaluateReactor({
      bars: appendCalm(shockSeries({}), 2),
      barsSinceShock: 2,
      armedShock: armedUp,
      event: { direction: "negative", confidence: 0.9, tradeRelevance: "high", riskFlags: [] },
      technicalDirection: "up",
      indexSupport: 0.8,
      currentExposurePct: 0,
      feedStale: false,
    });
    expect(d.action).toBe("reject");
    expect(d.rejectCode).toBe(BitgetRejectCode.SENTIMENT_CONFLICT);
  });

  it("rejects when the index is hostile", () => {
    const d = evaluateReactor({
      bars: appendCalm(shockSeries({}), 2),
      barsSinceShock: 2,
      armedShock: armedUp,
      technicalDirection: "up",
      indexSupport: 0.1,
      currentExposurePct: 0,
      feedStale: false,
    });
    expect(d.action).toBe("reject");
    expect(d.rejectCode).toBe(BitgetRejectCode.INDEX_HOSTILE);
  });

  it("rejects an unverified rumor", () => {
    const d = evaluateReactor({
      bars: appendCalm(shockSeries({}), 2),
      barsSinceShock: 2,
      armedShock: armedUp,
      event: { direction: "positive", confidence: 0.3, tradeRelevance: "low", riskFlags: ["rumor"] },
      technicalDirection: "up",
      indexSupport: 0.8,
      currentExposurePct: 0,
      feedStale: false,
    });
    expect(d.action).toBe("reject");
    expect(d.rejectCode).toBe(BitgetRejectCode.EVENT_UNCLEAR);
  });

  it("rejects a stale feed", () => {
    const d = evaluateReactor({
      bars: appendCalm(shockSeries({}), 2),
      barsSinceShock: 2,
      armedShock: armedUp,
      technicalDirection: "up",
      indexSupport: 0.8,
      currentExposurePct: 0,
      feedStale: true,
    });
    expect(d.action).toBe("reject");
    expect(d.rejectCode).toBe(BitgetRejectCode.STALE_FEED);
  });
});
