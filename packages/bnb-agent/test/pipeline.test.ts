import { describe, it, expect } from "vitest";
import {
  DEFAULT_RISK_CONFIG,
  EligibleAllowlist,
  parseMandate,
  type BscScoreInputs,
  type CalibrationReport,
} from "@wardenclaw/core";
import type { TwakPolicyConfig } from "@wardenclaw/twak-adapter";
import { evaluateCandidate, buildBscMandate, type CandidateInput, type PipelineContext } from "../src/index.js";

const USDT = "0x55d398326f99059ff775485246999027b3197955";
const USDC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const OFFLIST = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x10ed43c718714eb63d5aa57b78b54704e256024e";

const allowlist = new EligibleAllowlist([
  { symbol: "USDT", cmcId: 825, bscContractAddress: USDT, decimals: 18, isStable: true },
  { symbol: "USDC", cmcId: 3408, bscContractAddress: USDC, decimals: 18, isStable: true },
  { symbol: "CAKE", cmcId: 7186, bscContractAddress: CAKE, decimals: 18 },
]);

const twakPolicy: TwakPolicyConfig = {
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

const calibration: CalibrationReport = {
  version: "test-cal-1",
  generatedAt: "2026-06-20T00:00:00Z",
  historyDays: 30,
  bands: [
    { minScore: 60, realizedMoveBps: 60, hitRate: 0.4, realizedVsPredicted: 1 },
    { minScore: 80, realizedMoveBps: 400, hitRate: 0.9, realizedVsPredicted: 1 },
  ],
};

const strongInputs: BscScoreInputs = {
  momentum: 0.9,
  liquiditySafety: 0.9,
  relativeStrengthVsBnb: 0.9,
  sentiment: 0.9,
  volatilitySafety: 0.9,
  walletRiskState: 0.9,
};

function ctx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    config: DEFAULT_RISK_CONFIG,
    calibration,
    allowlist,
    twakPolicy,
    portfolioUsd: 40,
    deployableUsd: 38,
    windowDrawdownPct: 0,
    dailyDrawdownPct: 0,
    openPositions: 0,
    tradesToday: 0,
    survivalMode: false,
    marketDataStale: false,
    calibrationStale: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    symbol: "CAKE",
    signalFamily: "catalyst",
    scoreInputs: strongInputs,
    cmcToolsUsed: ["quotes", "trending", "fear_greed"],
    marketDataTimestamp: "2026-06-22T00:00:00Z",
    tokenInAddress: USDT,
    tokenOutAddress: CAKE,
    router: "pancakeswap",
    spender: ROUTER,
    to: ROUTER,
    atrPct: 0.04,
    reserveIn: 10_000_000,
    reserveOut: 10_000_000,
    poolFeeBps: 25,
    gasPerLegUsd: 0.01,
    ...overrides,
  };
}

describe("evaluateCandidate — approval", () => {
  it("approves a strong catalyst Attack candidate and emits a TWAK intent", () => {
    const r = evaluateCandidate(candidate(), ctx());
    expect(r.approved).toBe(true);
    expect(r.mode).toBe("attack");
    expect(r.signalFamily).toBe("catalyst");
    expect(r.economics.netEdgePassed).toBe(true);
    expect(r.economics.positionSizeUsd).toBeGreaterThan(0);
    expect(r.intent?.executionType).toBe("spot_only");
    expect(r.intent?.chainId).toBe(56);
  });

  it("builds a valid BSC mandate from the result with CMC attribution", () => {
    const r = evaluateCandidate(candidate(), ctx());
    const m = buildBscMandate({
      result: r,
      mode: "rehearsal",
      strategyId: "bsc-two-family",
      naturalLanguageIntent: "trade momentum + catalysts, spot only",
      compiledStrategy: {},
      assetContract: CAKE,
      cmcToolsUsed: r.economics ? ["quotes", "trending"] : [],
      marketDataTimestamp: "2026-06-22T00:00:00Z",
      calibrationVersion: calibration.version,
      createdAt: "2026-06-22T00:00:00Z",
      id: "bsc-1",
    });
    expect(() => parseMandate(m)).not.toThrow();
    expect(m.venue).toBe("bsc");
    expect(m.executionType).toBe("spot_only");
    expect(m.action).toBe("enter_long");
    expect(m.perception.cmcToolsUsed).toContain("quotes");
    expect(m.economics.calibrationVersion).toBe("test-cal-1");
  });
});

describe("evaluateCandidate — gate rejections", () => {
  it("rejects a low score (REJECT_LOW_SCORE)", () => {
    const weak = { ...strongInputs, momentum: 0.2, liquiditySafety: 0.2, relativeStrengthVsBnb: 0.2, sentiment: 0.2, volatilitySafety: 0.2, walletRiskState: 0.2 };
    const r = evaluateCandidate(candidate({ scoreInputs: weak }), ctx());
    expect(r.approved).toBe(false);
    expect(r.rejectCode).toBe("REJECT_LOW_SCORE");
  });

  it("rejects a non-spot route (REJECT_NON_SPOT)", () => {
    const r = evaluateCandidate(candidate({ isNonSpot: true }), ctx());
    expect(r.rejectCode).toBe("REJECT_NON_SPOT");
  });

  it("rejects an off-list token (REJECT_INELIGIBLE_CONTRACT)", () => {
    const r = evaluateCandidate(candidate({ tokenOutAddress: OFFLIST }), ctx());
    expect(r.rejectCode).toBe("REJECT_INELIGIBLE_CONTRACT");
  });

  it("rejects insufficient net edge (REJECT_NET_EDGE)", () => {
    const lowMove: CalibrationReport = {
      ...calibration,
      bands: [{ minScore: 80, realizedMoveBps: 20, hitRate: 0.9, realizedVsPredicted: 1 }],
    };
    const r = evaluateCandidate(candidate(), ctx({ calibration: lowMove }));
    expect(r.rejectCode).toBe("REJECT_NET_EDGE");
  });

  it("rejects an incoherent stop/size (REJECT_STOP_COHERENCE)", () => {
    // Huge per-leg gas makes friction exceed budget at any feasible size.
    const r = evaluateCandidate(candidate({ gasPerLegUsd: 5 }), ctx());
    expect(r.rejectCode).toBe("REJECT_STOP_COHERENCE");
  });

  it("aborts on adverse shadow-fill deviation (REJECT_SHADOW_FILL)", () => {
    const r = evaluateCandidate(candidate({ shadow: { expectedOut: 100, simulatedOut: 90 } }), ctx());
    expect(r.rejectCode).toBe("REJECT_SHADOW_FILL");
  });
});

describe("evaluateCandidate — governor + micro-scout", () => {
  it("shrinks size as the drawdown budget thins", () => {
    const healthy = evaluateCandidate(candidate(), ctx({ windowDrawdownPct: 0 }));
    const thin = evaluateCandidate(candidate(), ctx({ windowDrawdownPct: 14 }));
    expect(thin.governor.sizeFraction).toBeLessThan(healthy.governor.sizeFraction);
  });

  it("approves a stable↔stable Micro-Scout, exempt from net-edge", () => {
    const scout = candidate({
      symbol: "USDC",
      tokenInAddress: USDT,
      tokenOutAddress: USDC,
      isMicroScout: true,
      scoreInputs: { ...strongInputs, momentum: 0.1 },
    });
    const r = evaluateCandidate(scout, ctx());
    expect(r.approved).toBe(true);
    expect(r.signalFamily).toBe("scout");
    expect(r.economics.positionSizeUsd).toBe(DEFAULT_RISK_CONFIG.microScoutUsd);
  });

  it("still rejects a Micro-Scout to an off-list contract", () => {
    const r = evaluateCandidate(
      candidate({ tokenInAddress: USDT, tokenOutAddress: OFFLIST, isMicroScout: true }),
      ctx(),
    );
    expect(r.approved).toBe(false);
    expect(r.rejectCode).toBe("REJECT_INELIGIBLE_CONTRACT");
  });
});
