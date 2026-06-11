import { describe, it, expect } from "vitest";
import {
  BitgetMcpAgentHub,
  fundingRateToScore,
  sentimentRegime,
  type McpToolCaller,
} from "../src/index.js";

function fakeClient(payloads: Record<string, unknown>): McpToolCaller {
  return {
    async callTool<T>(name: string): Promise<T> {
      if (!(name in payloads)) throw new Error(`unexpected tool ${name}`);
      const v = payloads[name];
      if (v instanceof Error) throw v;
      return v as T;
    },
  };
}

const funding = (rate: string) => ({
  ok: true,
  data: { data: { currentFundRate: [{ symbol: "BTCUSDT", fundingRate: rate, maxFundingRate: "0.003" }] } },
});
const oi = (size: string) => ({ ok: true, data: { data: { openInterestList: [{ symbol: "BTCUSDT", size }] } } });

describe("funding-rate sentiment mapping", () => {
  it("is monotonic and bounded in [-1,1]", () => {
    expect(fundingRateToScore(0)).toBe(0);
    expect(fundingRateToScore(0.001)).toBeGreaterThan(fundingRateToScore(0.0003));
    expect(fundingRateToScore(0.01)).toBeLessThanOrEqual(1);
    expect(fundingRateToScore(-0.01)).toBeGreaterThanOrEqual(-1);
    expect(fundingRateToScore(-0.0005)).toBeLessThan(0);
  });

  it("classifies regimes by sign/magnitude", () => {
    expect(sentimentRegime(fundingRateToScore(0.0008))).toBe("risk_on");
    expect(sentimentRegime(fundingRateToScore(-0.0008))).toBe("risk_off");
    expect(sentimentRegime(fundingRateToScore(0.00003))).toBe("neutral");
  });
});

describe("BitgetMcpAgentHub (live Agent Hub derivatives sentiment)", () => {
  it("derives a real positioning sentiment from funding + OI", async () => {
    const hub = new BitgetMcpAgentHub(
      fakeClient({ futures_get_funding_rate: funding("0.0008"), futures_get_open_interest: oi("31856.21") }),
    );
    const d = await hub.getDerivativesSentiment("BTCUSDT");
    expect(d.fundingRate).toBeCloseTo(0.0008);
    expect(d.openInterest).toBeCloseTo(31856.21);
    expect(d.score).toBeGreaterThan(0.33);
    expect(d.regime).toBe("risk_on");
    expect(d.source).toContain("funding_rate");
  });

  it("flags crowded positioning at extremes", async () => {
    const hub = new BitgetMcpAgentHub(
      fakeClient({ futures_get_funding_rate: funding("0.003"), futures_get_open_interest: oi("100") }),
    );
    const d = await hub.getDerivativesSentiment("BTCUSDT");
    expect(d.riskFlags).toContain("crowded_positioning");
  });

  it("maps macro support into [0,1]", async () => {
    const hub = new BitgetMcpAgentHub(
      fakeClient({ futures_get_funding_rate: funding("-0.0008"), futures_get_open_interest: oi("100") }),
    );
    const m = await hub.fetchMacro();
    expect(m.support).toBeLessThan(0.5); // risk_off → below neutral
    expect(m.support).toBeGreaterThanOrEqual(0);
  });

  it("returns no news (never fabricates) — MCP has no news endpoint", async () => {
    const hub = new BitgetMcpAgentHub(fakeClient({}));
    expect(await hub.fetchNews("BTCUSDT")).toEqual([]);
  });

  it("throws (never fakes) when the symbol has no perp market", async () => {
    const hub = new BitgetMcpAgentHub(
      fakeClient({ futures_get_funding_rate: { ok: true, data: { data: { currentFundRate: [] } } }, futures_get_open_interest: oi("0") }),
    );
    await expect(hub.getDerivativesSentiment("AAPLXUSDT")).rejects.toThrow(/no funding rate/);
  });
});
