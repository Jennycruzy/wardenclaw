import { describe, it, expect, vi } from "vitest";
import { EligibleAllowlist } from "@runeclaw/core";
import {
  UnconfiguredTwakExecutor,
  PolicyEnforcingExecutor,
  buildRegistrationRequest,
  registrationOpen,
  registerForCompetition,
  payX402InLoop,
  isReceiptComplete,
  type TwakExecutor,
  type TwakIntent,
  type TwakPolicyConfig,
} from "../src/index.js";

const USDT = "0x55d398326f99059ff775485246999027b3197955";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const ROUTER = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
const OFFLIST = "0x1111111111111111111111111111111111111111";

const allowlist = new EligibleAllowlist([
  { symbol: "USDT", cmcId: 825, bscContractAddress: USDT, decimals: 18, isStable: true },
  { symbol: "CAKE", cmcId: 7186, bscContractAddress: CAKE, decimals: 18 },
]);

const config: TwakPolicyConfig = {
  requiredChainId: 56,
  allowedRouters: ["pancakeswap"],
  allowedSpenders: [ROUTER],
  allowedContracts: [ROUTER],
  maxTradeUsd: 30,
  maxDailySpendUsd: 20,
  maxSlippageBps: 50,
  allowInfiniteApprovals: false,
  approvalBufferBps: 50,
};

function intent(overrides: Partial<TwakIntent> = {}): TwakIntent {
  return {
    kind: "swap",
    chainId: 56,
    executionType: "spot_only",
    router: "pancakeswap",
    spender: ROUTER,
    to: ROUTER,
    tokenInAddress: USDT,
    tokenOutAddress: CAKE,
    amountInUsd: 15,
    txValueWei: "0",
    isInfiniteApproval: false,
    approvalAmount: 15,
    mandateAmount: 15,
    slippageBps: 30,
    isNonSpot: false,
    decodedAction: "enter_long",
    mandateAction: "enter_long",
    ...overrides,
  };
}

/** A fake real executor that records whether it was asked to sign. */
function fakeExecutor(): TwakExecutor & { signs: number } {
  return {
    configured: true,
    signs: 0,
    async resolveAgentWallet() {
      return "0xagentwallet";
    },
    async signAndSubmit(_i: TwakIntent) {
      this.signs++;
      return { txHash: "0xfeed", twakReceiptId: "twak-1", status: "submitted" as const };
    },
    async registerForCompetition(contractAddress: string) {
      return {
        registered: true,
        contractAddress,
        agentWallet: "0xagentwallet",
        registrationTxHash: "0xregtx",
        detail: "registered",
      };
    },
    async payX402(req) {
      return {
        requestUrl: req.url,
        amount: req.maxAmount,
        asset: req.asset,
        payer: "0xagentwallet",
        recipient: "0xcmc",
        receipt: "0xrcpt",
        responseSummary: "ok",
        usedInDecision: false,
        timestamp: "2026-06-22T00:00:00Z",
      };
    },
  };
}

describe("UnconfiguredTwakExecutor", () => {
  it("fails loudly on every surface (no fake signatures/hashes)", async () => {
    const e = new UnconfiguredTwakExecutor();
    expect(e.configured).toBe(false);
    await expect(e.resolveAgentWallet()).rejects.toThrow(/not configured/);
    await expect(e.signAndSubmit(intent())).rejects.toThrow(/not configured/);
    await expect(e.registerForCompetition("0x")).rejects.toThrow(/not configured/);
    await expect(e.payX402({ url: "u", maxAmount: "1", asset: "USDC" })).rejects.toThrow(/not configured/);
  });
});

describe("PolicyEnforcingExecutor", () => {
  it("signs a clean intent through the inner executor", async () => {
    const inner = fakeExecutor();
    const pe = new PolicyEnforcingExecutor(inner, allowlist, config);
    const out = await pe.execute(intent());
    expect(out.refused).toBe(false);
    expect(out.receipt?.txHash).toBe("0xfeed");
    expect(inner.signs).toBe(1);
  });

  it("refuses a bad intent BEFORE signing (inner never called)", async () => {
    const inner = fakeExecutor();
    const pe = new PolicyEnforcingExecutor(inner, allowlist, config);
    const out = await pe.execute(intent({ tokenOutAddress: OFFLIST }));
    expect(out.refused).toBe(true);
    expect(out.receipt).toBeUndefined();
    expect(inner.signs).toBe(0);
  });
});

describe("registration", () => {
  const beforeWindow = Date.parse("2026-06-20T00:00:00Z");
  const afterWindow = Date.parse("2026-06-23T00:00:00Z");

  it("targets the verified competition contract", () => {
    expect(buildRegistrationRequest().contractAddress).toBe(
      "0x212c61b9b72c95d95bf29cf032f5e5635629aed5",
    );
  });

  it("is open before the window and closed after", () => {
    expect(registrationOpen(beforeWindow)).toBe(true);
    expect(registrationOpen(afterWindow)).toBe(false);
  });

  it("registers through the executor before the window", async () => {
    const r = await registerForCompetition(fakeExecutor(), beforeWindow);
    expect(r.registered).toBe(true);
    expect(r.registrationTxHash).toBe("0xregtx");
  });

  it("refuses to register after the window opens", async () => {
    const r = await registerForCompetition(fakeExecutor(), afterWindow);
    expect(r.registered).toBe(false);
    expect(r.detail).toMatch(/window closed/);
  });
});

describe("x402 in the trade loop", () => {
  it("pays and tags the receipt as used in the decision", async () => {
    const r = await payX402InLoop(fakeExecutor(), {
      url: "https://cmc/x402/quotes",
      maxAmount: "0.01",
      asset: "USDC",
      mandateId: "m1",
    });
    expect(r.usedInDecision).toBe(true);
    expect(r.mandateId).toBe("m1");
    expect(isReceiptComplete(r)).toBe(true);
  });
});
