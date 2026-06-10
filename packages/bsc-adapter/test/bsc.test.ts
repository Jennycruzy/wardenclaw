import { describe, it, expect } from "vitest";
import {
  RpcManager,
  NoHealthyRpcError,
  UnconfiguredQuoteProvider,
  constantProductOut,
  expectedSlippageBps,
  loadEligibleTokens,
  findBySymbol,
  STARTER_TOKENS,
  PANCAKE_V2_ROUTER,
  type RpcProbe,
} from "../src/index.js";

describe("RpcManager failover", () => {
  it("fails over from a dead endpoint to a healthy one", async () => {
    const dead = "https://dead.example";
    const live = "https://live.example";
    const probe: RpcProbe = async (url) => url === live;
    const mgr = new RpcManager({ urls: [dead, live], probe, failureThreshold: 1 });
    await mgr.refreshHealth(1000);
    expect(mgr.selectHealthy()).toBe(live);
  });

  it("throws (never hangs) when the whole pool is down", async () => {
    const probe: RpcProbe = async () => false;
    const mgr = new RpcManager({ urls: ["a", "b"], probe, failureThreshold: 1 });
    await mgr.refreshHealth(1000);
    expect(() => mgr.selectHealthy()).toThrow(NoHealthyRpcError);
  });

  it("marks the active endpoint failed and fails over", async () => {
    const probe: RpcProbe = async () => true;
    const mgr = new RpcManager({ urls: ["a", "b"], probe, failureThreshold: 1 });
    await mgr.refreshHealth(1000);
    const next = mgr.markActiveFailed();
    expect(next).toBe("b");
  });

  it("requires at least one URL", () => {
    expect(() => new RpcManager({ urls: [], probe: async () => true })).toThrow();
  });
});

describe("constant-product quote model", () => {
  it("computes output and price impact from reserves", () => {
    const q = constantProductOut({ amountIn: 1000, reserveIn: 1_000_000, reserveOut: 1_000_000, feeBps: 25 });
    expect(q.midPrice).toBe(1);
    expect(q.amountOut).toBeGreaterThan(0);
    expect(q.amountOut).toBeLessThan(1000);
    expect(q.priceImpactBps).toBeGreaterThan(0);
  });

  it("larger trades have larger price impact (thin pool)", () => {
    const small = expectedSlippageBps({ amountIn: 100, reserveIn: 100_000, reserveOut: 100_000, feeBps: 25 });
    const big = expectedSlippageBps({ amountIn: 10_000, reserveIn: 100_000, reserveOut: 100_000, feeBps: 25 });
    expect(big).toBeGreaterThan(small);
  });

  it("rejects non-positive reserves", () => {
    expect(() => constantProductOut({ amountIn: 1, reserveIn: 0, reserveOut: 1, feeBps: 25 })).toThrow();
  });
});

describe("UnconfiguredQuoteProvider", () => {
  it("fails loudly (never fabricates a quote)", async () => {
    const p = new UnconfiguredQuoteProvider();
    expect(p.configured).toBe(false);
    await expect(p.quote({ tokenInAddress: "a", tokenOutAddress: "b", amountIn: 1 })).rejects.toThrow(/not configured/);
  });
});

describe("eligible-token loader", () => {
  it("falls back to canonical starter tokens when the file is absent", () => {
    const loaded = loadEligibleTokens("/nonexistent/eligible.json");
    expect(loaded.source).toBe("starter_fallback");
    expect(loaded.tokens.length).toBe(STARTER_TOKENS.length);
    // Both Micro-Scout legs are present and eligible.
    const usdt = findBySymbol(loaded.tokens, "USDT")!;
    const usdc = findBySymbol(loaded.tokens, "USDC")!;
    expect(loaded.allowlist.isEligible(usdt.bscContractAddress)).toBe(true);
    expect(loaded.allowlist.isEligible(usdc.bscContractAddress)).toBe(true);
  });

  it("exposes the canonical PancakeSwap V2 router", () => {
    expect(PANCAKE_V2_ROUTER).toMatch(/^0x[0-9a-f]{40}$/);
  });
});
