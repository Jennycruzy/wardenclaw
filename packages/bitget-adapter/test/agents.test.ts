import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuditLogger,
  verifyChain,
  parseMandate,
} from "@wardenclaw/core";
import {
  BitgetReactorAgent,
  PaperBook,
  DEFAULT_BITGET_AGENT_CONFIG,
  type AssetPerception,
  type BitgetAgentConfig,
  type ShockDetection,
} from "../src/index.js";
import { shockSeries, appendCalm } from "./helpers.js";

const armedUp: ShockDetection = { isShock: true, magnitudePct: 0.06, volumeRatio: 3, direction: "up" };

function makeAgent() {
  const dir = mkdtempSync(join(tmpdir(), "wardenclaw-bitget-"));
  const auditPath = join(dir, "audit.jsonl");
  const book = new PaperBook(10_000);
  const audit = new AuditLogger(auditPath);
  const cfg: BitgetAgentConfig = { ...DEFAULT_BITGET_AGENT_CONFIG, compiledStrategy: {} };
  let n = 0;
  const now = () => new Date(Date.UTC(2026, 5, 1, 0, 0, n++)).toISOString();
  const agent = new BitgetReactorAgent(cfg, book, audit, auditPath, now);
  return { agent, book, audit, auditPath, dir };
}

function confirmedPerception(asset: string): AssetPerception {
  return {
    asset,
    bars: appendCalm(shockSeries({}), 2),
    barsSinceShock: 2,
    armedShock: armedUp,
    midPrice: 106,
    marketDataTimestamp: "2026-06-01T00:05:00Z",
    indexSupport: 0.8,
    feedStale: false,
  };
}

describe("BitgetReactorAgent cycle", () => {
  it("produces a validated, filled mandate for a confirmed entry", async () => {
    const { agent, book, audit, dir } = makeAgent();
    try {
      const result = await agent.runCycle([confirmedPerception("NVDAx")]);
      expect(result.executedAsset).toBe("NVDAx");
      const m = result.mandates[0]!;
      expect(() => parseMandate(m)).not.toThrow();
      expect(m.execution.status).toBe("filled");
      expect(m.execution.adapter).toBe("internal_paper_engine");
      expect((m.execution.paperFill as Record<string, unknown>).simulated).toBe(true);
      expect(m.venue).toBe("bitget");
      expect(m.executionType).toBe("paper");
      expect(m.proofAnchors.paperFillSource).toContain("internal_paper_engine");
      // The paper book actually opened the position.
      expect(book.getPosition("NVDAx")).toBeDefined();

      // The audit chain is intact end to end.
      const events = await audit.readAll();
      expect(events.length).toBeGreaterThan(0);
      expect(verifyChain(events)).toBe(-1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("audits a first-spike skip without opening a position", async () => {
    const { agent, book, dir } = makeAgent();
    try {
      const result = await agent.runCycle([
        {
          asset: "TSLAx",
          bars: shockSeries({}),
          barsSinceShock: 0,
          armedShock: armedUp,
          midPrice: 106,
          marketDataTimestamp: "2026-06-01T00:05:00Z",
          indexSupport: 0.8,
          feedStale: false,
        },
      ]);
      expect(result.executedAsset).toBeNull();
      const m = result.mandates[0]!;
      expect(m.execution.status).toBe("rejected");
      expect(m.decision.rejectedReasons).toContain("REJECT_FIRST_SPIKE");
      expect(book.getPosition("TSLAx")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("arms the watchdog triggers (incl. sentiment_reversal) on a filled mandate", async () => {
    const { agent, dir } = makeAgent();
    try {
      const result = await agent.runCycle([confirmedPerception("NVDAx")]);
      const m = result.mandates[0]!;
      expect(m.watchdog.armed).toBe(true);
      expect(m.watchdog.triggers).toEqual(
        expect.arrayContaining(["volatility_stop", "take_profit", "sentiment_reversal", "max_hold"]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits an open position when sentiment reverses (watchdog sentiment_reversal)", async () => {
    const { agent, book, audit, dir } = makeAgent();
    try {
      // Cycle 1: confirmed entry.
      await agent.runCycle([confirmedPerception("NVDAx")]);
      expect(book.getPosition("NVDAx")).toBeDefined();

      // Cycle 2: price holds between stop and target, but real news turns
      // negative with high confidence → the watchdog closes the long.
      const p = confirmedPerception("NVDAx");
      p.midPrice = 106.2;
      p.marketDataTimestamp = "2026-06-01T00:10:00Z";
      p.event = {
        direction: "negative",
        confidence: 0.9,
        tradeRelevance: "high",
        riskFlags: [],
      };
      const result = await agent.runCycle([p]);
      expect(book.getPosition("NVDAx")).toBeUndefined();
      expect(result.exits).toHaveLength(1);
      expect(result.exits[0]!.reason).toBe("watchdog");

      // The fired trigger is recorded as a watchdog-stage audit event.
      const events = await audit.readAll();
      const wd = events.find((e) => e.stage === "watchdog");
      expect(wd).toBeDefined();
      expect(wd!.output).toMatchObject({
        trigger: "sentiment_reversal",
        action: "close_position",
      });
      expect(verifyChain(events)).toBe(-1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not exit on a low-confidence negative event", async () => {
    const { agent, book, dir } = makeAgent();
    try {
      await agent.runCycle([confirmedPerception("NVDAx")]);
      const p = confirmedPerception("NVDAx");
      p.midPrice = 106.2;
      p.marketDataTimestamp = "2026-06-01T00:10:00Z";
      p.event = {
        direction: "negative",
        confidence: 0.3,
        tradeRelevance: "high",
        riskFlags: [],
      };
      const result = await agent.runCycle([p]);
      expect(book.getPosition("NVDAx")).toBeDefined();
      expect(result.exits).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executes only the top-ranked candidate when several confirm", async () => {
    const { agent, book, dir } = makeAgent();
    try {
      const strong = confirmedPerception("NVDAx");
      const weak = confirmedPerception("AAPLx");
      // Make AAPLx a weaker shock so NVDAx wins.
      weak.armedShock = { isShock: true, magnitudePct: 0.041, volumeRatio: 2, direction: "up" };
      const result = await agent.runCycle([weak, strong]);
      expect(result.executedAsset).toBe("NVDAx");
      // Exactly one position opened.
      expect(book.openPositions()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("BitgetReactorAgent in official demo mode", () => {
  it("executes through the demo executor and anchors the real order id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wardenclaw-bitget-demo-"));
    const auditPath = join(dir, "audit.jsonl");
    try {
      const book = new PaperBook(10_000);
      const audit = new AuditLogger(auditPath);
      const cfg: BitgetAgentConfig = {
        ...DEFAULT_BITGET_AGENT_CONFIG,
        executionMode: "official_bitget_demo",
        compiledStrategy: {},
      };
      const buys: Array<Record<string, unknown>> = [];
      const demoExecutor = {
        async marketBuy(args: { symbol: string; quoteNotionalUsd: number; clientOid?: string }) {
          buys.push({ ...args });
          return {
            orderId: "demo-o1",
            clientOid: args.clientOid,
            symbol: args.symbol,
            side: "buy" as const,
            status: "filled" as const,
            fills: [
              { tradeId: "t1", price: 106.1, size: args.quoteNotionalUsd / 106.1, amount: args.quoteNotionalUsd, timestamp: "2026-06-01T00:05:01Z" },
            ],
            avgFillPrice: 106.1,
            filledQuantity: args.quoteNotionalUsd / 106.1,
            filledQuoteUsd: args.quoteNotionalUsd,
            placedAt: "2026-06-01T00:05:01Z",
            source: "official_bitget_demo" as const,
            demoTrading: true as const,
          };
        },
        async marketSell() {
          throw new Error("not used in this test");
        },
      };
      let n = 0;
      const now = () => new Date(Date.UTC(2026, 5, 1, 0, 0, n++)).toISOString();
      const agent = new BitgetReactorAgent(cfg, book, audit, auditPath, now, {
        demoExecutor,
        symbolFor: () => "NVDAONUSDT",
      });

      const result = await agent.runCycle([confirmedPerception("NVDAx")]);
      expect(result.executedAsset).toBe("NVDAx");
      const m = result.mandates[0]!;
      expect(() => parseMandate(m)).not.toThrow();
      expect(m.execution.status).toBe("filled");
      expect(m.execution.adapter).toBe("official_bitget_demo");
      expect(m.execution.paperFill).toBeUndefined();
      expect((m.execution.finalOrder as Record<string, unknown>).orderId).toBe("demo-o1");
      expect(m.proofAnchors.bitgetRequestId).toBe("demo-o1");
      expect(m.proofAnchors.paperFillSource).toBeUndefined();
      expect(buys[0]).toMatchObject({ symbol: "NVDAONUSDT" });
      // Book mirrors the REAL fill at the demo fill price for tracking.
      expect(book.getPosition("NVDAx")?.entryPrice).toBeCloseTo(106.1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to construct demo mode without an executor (never silently paper-fills)", () => {
    const dir = mkdtempSync(join(tmpdir(), "wardenclaw-bitget-demo-"));
    const auditPath = join(dir, "audit.jsonl");
    try {
      const cfg: BitgetAgentConfig = {
        ...DEFAULT_BITGET_AGENT_CONFIG,
        executionMode: "official_bitget_demo",
        compiledStrategy: {},
      };
      expect(
        () => new BitgetReactorAgent(cfg, new PaperBook(10_000), new AuditLogger(auditPath), auditPath),
      ).toThrow(/requires a DemoSpotExecutor/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
