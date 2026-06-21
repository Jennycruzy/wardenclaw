import { describe, it, expect } from "vitest";
import { PaperBook } from "../src/index.js";

describe("PaperBook", () => {
  it("opens and closes a position with labeled, simulated fills", () => {
    const book = new PaperBook(1000);
    const fill = book.open({
      asset: "NVDAx",
      refPrice: 100,
      notionalUsd: 500,
      stopPrice: 95,
      slippageBps: 10,
      timestamp: "2026-06-01T00:00:00Z",
    });
    expect(fill.source).toBe("internal_paper_engine");
    expect(fill.simulated).toBe(true);
    // Buy fills slightly above mid due to slippage.
    expect(fill.fillPrice).toBeCloseTo(100.1, 5);
    expect(book.cash).toBeCloseTo(500, 5);
    expect(book.getPosition("NVDAx")).toBeDefined();

    const trade = book.close({
      asset: "NVDAx",
      refPrice: 110,
      slippageBps: 10,
      timestamp: "2026-06-01T01:00:00Z",
      reason: "signal_exit",
    });
    expect(trade.pnlUsd).toBeGreaterThan(0);
    expect(book.getPosition("NVDAx")).toBeUndefined();
    expect(book.closedTrades()).toHaveLength(1);
    // Every fill is labeled simulated.
    expect(book.allFills().every((f) => f.simulated)).toBe(true);
  });

  it("marks equity to market across open positions", () => {
    const book = new PaperBook(1000);
    book.open({
      asset: "AAPLx",
      refPrice: 100,
      notionalUsd: 400,
      stopPrice: 95,
      slippageBps: 0,
      timestamp: "2026-06-01T00:00:00Z",
    });
    // Price doubles → the 4 shares are worth ~800, plus 600 cash.
    expect(book.equity({ AAPLx: 200 })).toBeCloseTo(1400, 0);
  });

  it("rejects opening a duplicate position", () => {
    const book = new PaperBook(1000);
    book.open({
      asset: "AAPLx",
      refPrice: 100,
      notionalUsd: 100,
      stopPrice: 95,
      slippageBps: 0,
      timestamp: "t",
    });
    expect(() =>
      book.open({ asset: "AAPLx", refPrice: 100, notionalUsd: 100, stopPrice: 95, slippageBps: 0, timestamp: "t" }),
    ).toThrow(/already open/);
  });

  it("restores an exact snapshot across process restarts", () => {
    const first = new PaperBook(1_000);
    first.open({
      asset: "NVDAx",
      refPrice: 100,
      notionalUsd: 200,
      stopPrice: 95,
      slippageBps: 10,
      timestamp: "2026-06-21T00:00:00.000Z",
    });
    const restored = new PaperBook(1_000, first.snapshot());

    expect(restored.cash).toBe(first.cash);
    expect(restored.openPositions()).toEqual(first.openPositions());
    expect(restored.allFills()).toEqual(first.allFills());
    expect(restored.equity({ NVDAx: 105 })).toBe(first.equity({ NVDAx: 105 }));
  });

  it("rejects opening beyond available cash", () => {
    const book = new PaperBook(100);
    expect(() =>
      book.open({ asset: "AAPLx", refPrice: 100, notionalUsd: 500, stopPrice: 95, slippageBps: 0, timestamp: "t" }),
    ).toThrow(/insufficient/);
  });
});
