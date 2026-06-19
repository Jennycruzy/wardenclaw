import { describe, it, expect } from "vitest";
import {
  callWardenTool,
  createWardenMcpContext,
  WARDEN_MCP_TOOLS,
  type MarketContext,
  type TradeIntent,
} from "../src/index.js";

const KEY = "test-key";
const NOW = "2026-06-19T15:00:00Z";

function market(over: Partial<MarketContext> = {}): MarketContext {
  return {
    nowIso: NOW, knownAsset: true, btcCorrelated: false, price: 100, underlyingRefPrice: 100,
    spreadBps: 10, volPctile: 0.9, confirmationPresent: true, marketOpen: true,
    btcRealizedVolRising: false, feedAgeSec: 5, closeOnlyActive: false, ...over,
  };
}
const intent: TradeIntent = {
  asset: "NVDAx", direction: "long", notionalUsd: 500, leverage: 5,
  orderType: "market", triggerSource: "ai_agent", rawCommand: "Long NVDAx $500 5x",
};

describe("WardenClaw MCP tool surface", () => {
  it("declares all seven tools", () => {
    expect(WARDEN_MCP_TOOLS.map((t) => t.name).sort()).toEqual(
      ["audit_strategy", "get_card", "get_closeonly_status", "replay_card", "request_permit", "run_ghost_sim", "verify_permit"],
    );
  });

  it("audit_strategy → Rejected for a martingale strategy", () => {
    const r = callWardenTool("audit_strategy", { strategy: "Double size after every loss." }, createWardenMcpContext(KEY));
    expect(r.ok).toBe(true);
    expect((r.data as { verdict: string }).verdict).toBe("Rejected");
  });

  it("end-to-end: audit_strategy → request_permit → verify_permit round-trip", () => {
    const ctx = createWardenMcpContext(KEY);

    const audit = callWardenTool("audit_strategy", { strategy: "Long NVDAx 2x. Daily loss 4%, cooldown after news, confirmation." }, ctx);
    expect((audit.data as { mayEmitMandates: boolean }).mayEmitMandates).toBe(true);

    const permitRes = callWardenTool("request_permit", { intent, market: market() }, ctx);
    const data = permitRes.data as { verdict: string; permit: { permit_id: string } };
    expect(data.verdict).toBe("REDUCE");
    expect(data.permit.permit_id).toMatch(/^WARDEN-NVDAX-/);

    const verify = callWardenTool("verify_permit", {
      permit_id: data.permit.permit_id, currentPrice: 100, requestedAction: "long", nowIso: NOW,
    }, ctx);
    expect((verify.data as { ok: boolean }).ok).toBe(true);

    // get_card and replay_card resolve the stored permit.
    expect(callWardenTool("get_card", { permit_id: data.permit.permit_id }, ctx).ok).toBe(true);
    const replay = callWardenTool("replay_card", { permit_id: data.permit.permit_id }, ctx);
    expect((replay.data as { verification: { ok: boolean } }).verification.ok).toBe(true);
  });

  it("request_permit returns no permit for a BLOCK", () => {
    const ctx = createWardenMcpContext(KEY);
    const r = callWardenTool("request_permit", { intent: { ...intent, leverage: 8 }, market: market({ earningsWithinHours: 5 }) }, ctx);
    const data = r.data as { verdict: string; permit: null };
    expect(data.verdict).toBe("BLOCK");
    expect(data.permit).toBeNull();
  });

  it("get_closeonly_status reports survival mode", () => {
    const r = callWardenTool("get_closeonly_status", {}, createWardenMcpContext(KEY));
    expect((r.data as { active: boolean }).active).toBe(false);
  });
});
