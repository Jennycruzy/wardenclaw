import { describe, it, expect } from "vitest";
import { buildEvent, GENESIS_HASH, replayMandate, type AuditEvent } from "../src/index.js";

function chainFor(): AuditEvent[] {
  const e1 = buildEvent(
    {
      timestamp: "t0",
      mandateId: "m1",
      stage: "perception",
      input: {},
      output: { source: "cmc", price: 2.1 },
      proofAnchors: { cmcRequestId: "req-1" },
    },
    GENESIS_HASH,
  );
  const e2 = buildEvent(
    {
      timestamp: "t1",
      mandateId: "m1",
      stage: "decision",
      input: {},
      output: { signalFamily: "catalyst", tradeScore: 82 },
    },
    e1.eventHash,
  );
  const e3 = buildEvent(
    {
      timestamp: "t2",
      mandateId: "m1",
      stage: "economics",
      input: {},
      output: { rejectCode: "REJECT_NET_EDGE", expectedMoveBps: 100, frictionBps: 120 },
    },
    e2.eventHash,
  );
  const e4 = buildEvent(
    {
      timestamp: "t3",
      mandateId: "m1",
      stage: "execution",
      input: {},
      output: { status: "filled" },
      proofAnchors: { bscTxHash: "0xabc", twakReceipt: "r1" },
    },
    e3.eventHash,
  );
  return [e1, e2, e3, e4];
}

describe("replay engine", () => {
  it("reconstructs perception, decision, economics and rejections", () => {
    const replay = replayMandate("m1", chainFor());
    expect(replay.integrityOk).toBe(true);
    expect(replay.decision).toMatchObject({ signalFamily: "catalyst", tradeScore: 82 });
    expect(replay.rejections).toHaveLength(1);
    expect(replay.rejections[0]!.output.rejectCode).toBe("REJECT_NET_EDGE");
  });

  it("surfaces external proof anchors", () => {
    const replay = replayMandate("m1", chainFor());
    expect(replay.proof.truthAnchors.some((a) => a.includes("0xabc"))).toBe(true);
    expect(replay.proof.paperOnly).toBe(false);
  });

  it("flags a broken integrity chain", () => {
    const chain = chainFor();
    chain[1] = { ...chain[1]!, output: { tampered: true } };
    const replay = replayMandate("m1", chain);
    expect(replay.integrityOk).toBe(false);
    expect(replay.integrityBreakIndex).toBe(1);
  });
});
