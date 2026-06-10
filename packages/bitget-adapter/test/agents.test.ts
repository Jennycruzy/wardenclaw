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
