import { describe, it, expect } from "vitest";
import { EligibleAllowlist, RejectCode } from "@runeclaw/core";
import {
  evaluateTwakPolicy,
  TwakRejectCode,
  type TwakIntent,
  type TwakPolicyConfig,
} from "../src/index.js";

const USDT = "0x55d398326f99059ff775485246999027b3197955";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const OFFLIST = "0x1111111111111111111111111111111111111111";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const ROUTER = "0x10ed43c718714eb63d5aa57b78b54704e256024e"; // PancakeSwap V2 router

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

function cleanIntent(overrides: Partial<TwakIntent> = {}): TwakIntent {
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
    mandateId: "m1",
    ...overrides,
  };
}

describe("evaluateTwakPolicy — approves a clean spot swap", () => {
  it("passes every check", () => {
    const r = evaluateTwakPolicy(cleanIntent(), allowlist, config, { spentTodayUsd: 0 });
    expect(r.approved).toBe(true);
    expect(r.passedChecks).toContain("action_match");
  });
});

describe("evaluateTwakPolicy — refuses bad intents (the refusal matrix)", () => {
  const cases: Array<[string, Partial<TwakIntent>, string]> = [
    ["non-spot route", { isNonSpot: true }, RejectCode.NON_SPOT],
    ["wrong chain", { chainId: 1 }, RejectCode.WRONG_CHAIN],
    ["bad router", { router: "uniswap" }, RejectCode.ROUTER_NOT_ALLOWED],
    ["unknown spender", { spender: OFFLIST }, RejectCode.SPENDER_NOT_ALLOWED],
    ["contract not allowed", { to: OFFLIST }, TwakRejectCode.CONTRACT_NOT_ALLOWED],
    ["off-list token", { tokenOutAddress: OFFLIST }, RejectCode.INELIGIBLE_CONTRACT],
    ["holding WBNB", { tokenOutAddress: WBNB }, RejectCode.HELD_NATIVE_OR_WBNB],
    ["infinite approval", { isInfiniteApproval: true }, RejectCode.INFINITE_APPROVAL],
    ["over-approval", { approvalAmount: 100, mandateAmount: 15 }, RejectCode.INFINITE_APPROVAL],
    ["slippage too high", { slippageBps: 80 }, RejectCode.SLIPPAGE],
    ["over max trade", { amountInUsd: 40 }, TwakRejectCode.OVER_MAX_TRADE],
    ["action mismatch", { decodedAction: "exit", mandateAction: "enter_long" }, TwakRejectCode.ACTION_MISMATCH],
    ["paper intent at live signer", { executionType: "paper" }, TwakRejectCode.PAPER_INTENT_LIVE],
  ];

  for (const [name, override, code] of cases) {
    it(`refuses: ${name} → ${code}`, () => {
      const r = evaluateTwakPolicy(cleanIntent(override), allowlist, config, { spentTodayUsd: 0 });
      expect(r.approved).toBe(false);
      expect(r.rejectCode).toBe(code);
    });
  }

  it("refuses when the daily spend cap would be exceeded", () => {
    const r = evaluateTwakPolicy(cleanIntent({ amountInUsd: 15 }), allowlist, config, { spentTodayUsd: 10 });
    expect(r.approved).toBe(false);
    expect(r.rejectCode).toBe(TwakRejectCode.OVER_DAILY_SPEND);
  });
});
