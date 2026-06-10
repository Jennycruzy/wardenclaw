import { describe, it, expect } from "vitest";
import {
  selectExecutionMode,
  OfficialBitgetDemoExecutor,
  rankShocks,
  topShock,
  assertXPerpsEnabled,
  XPERPS_MODULE,
  type ShockCandidate,
} from "../src/index.js";

describe("execution mode selection", () => {
  it("uses the internal paper engine when official demo is unverified", () => {
    const sel = selectExecutionMode({ officialDemoVerified: false, backtest: false });
    expect(sel.mode).toBe("internal_paper_engine");
  });

  it("uses official demo only when verified", () => {
    const sel = selectExecutionMode({ officialDemoVerified: true, backtest: false });
    expect(sel.mode).toBe("official_bitget_demo");
  });

  it("uses backtest mode when requested", () => {
    const sel = selectExecutionMode({ officialDemoVerified: true, backtest: true });
    expect(sel.mode).toBe("backtest");
  });

  it("the official demo executor fails loudly (never fakes a fill)", () => {
    expect(() => new OfficialBitgetDemoExecutor().open()).toThrow(/not implemented/);
  });
});

describe("xPerps module", () => {
  it("is disabled and refuses to run even if env asks", () => {
    expect(XPERPS_MODULE.enabled).toBe(false);
    expect(() => assertXPerpsEnabled(true)).toThrow(/xPerps disabled/);
  });
});

describe("EventShockRanker", () => {
  const mk = (asset: string, score: number, move: number): ShockCandidate => ({
    asset,
    decision: { action: "enter_long", reason: [], score, expectedMoveBps: move },
  });

  it("ranks confirmed entries by score then expected move", () => {
    const ranked = rankShocks([mk("AAPLx", 70, 50), mk("NVDAx", 85, 40), mk("TSLAx", 85, 90)]);
    expect(ranked.map((r) => r.asset)).toEqual(["TSLAx", "NVDAx", "AAPLx"]);
    expect(topShock([mk("AAPLx", 70, 50), mk("NVDAx", 85, 40)])!.asset).toBe("NVDAx");
  });

  it("excludes non-entry decisions from ranking", () => {
    const ranked = rankShocks([
      mk("NVDAx", 85, 40),
      { asset: "TSLAx", decision: { action: "reject", reason: ["first spike"], rejectCode: "REJECT_FIRST_SPIKE" } },
    ]);
    expect(ranked.map((r) => r.asset)).toEqual(["NVDAx"]);
  });

  it("returns null when nothing is confirmed", () => {
    expect(topShock([{ asset: "X", decision: { action: "wait", reason: [] } }])).toBeNull();
  });
});
