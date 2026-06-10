import { describe, it, expect } from "vitest";
import { buildEvent, verifyChain, GENESIS_HASH, type AuditEvent } from "../src/index.js";

function makeChain(): AuditEvent[] {
  const e1 = buildEvent(
    { timestamp: "2026-06-22T00:00:00Z", mandateId: "m1", stage: "perception", input: { a: 1 }, output: {} },
    GENESIS_HASH,
  );
  const e2 = buildEvent(
    { timestamp: "2026-06-22T00:00:01Z", mandateId: "m1", stage: "decision", input: {}, output: { score: 82 } },
    e1.eventHash,
  );
  const e3 = buildEvent(
    { timestamp: "2026-06-22T00:00:02Z", mandateId: "m1", stage: "execution", input: {}, output: { status: "filled" } },
    e2.eventHash,
  );
  return [e1, e2, e3];
}

describe("audit hash chain", () => {
  it("validates an intact chain", () => {
    expect(verifyChain(makeChain())).toBe(-1);
  });

  it("detects a tampered event payload", () => {
    const chain = makeChain();
    chain[1] = { ...chain[1]!, output: { score: 99 } };
    expect(verifyChain(chain)).toBe(1);
  });

  it("detects a broken link", () => {
    const chain = makeChain();
    chain[2] = { ...chain[2]!, previousHash: "deadbeef" };
    expect(verifyChain(chain)).toBe(2);
  });

  it("is deterministic for identical input", () => {
    const a = buildEvent(
      { timestamp: "t", mandateId: "m", stage: "risk", input: { x: 1 }, output: { y: 2 } },
      GENESIS_HASH,
    );
    const b = buildEvent(
      { timestamp: "t", mandateId: "m", stage: "risk", input: { x: 1 }, output: { y: 2 } },
      GENESIS_HASH,
    );
    expect(a.eventHash).toBe(b.eventHash);
  });
});
