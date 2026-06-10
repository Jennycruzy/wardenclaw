/**
 * The Risk Constitution: the deterministic, non-negotiable gate chain every
 * candidate trade must pass before execution. The LLM may propose; this verifies;
 * any single failed gate vetoes the trade and records a reject code with numbers.
 *
 * Forced safety exits (stop-loss enforcement, survival liquidation) bypass the
 * net-edge gate but still must be spot-only between eligible contracts on chain 56.
 */

import { evaluateNetEdge } from "./netEdgeGate.js";
import { evaluateShadowFill } from "./shadowFill.js";
import { assertLegsEligible, EligibleAllowlist } from "./eligibleTokens.js";
import { RejectCode } from "./types.js";
import type { RiskConfig } from "./config.js";
import { COMPETITION } from "./config.js";

export interface RiskGateCandidate {
  chainId: number;
  router: string;
  spender: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  approvalAmount: number; // token units the approval would grant
  mandateAmount: number; // token units the mandate authorizes
  isInfiniteApproval: boolean;
  /** Whether this candidate is a leveraged / perp / margin route. */
  isNonSpot: boolean;
  notionalUsd: number;
  expectedMoveBps: number;
  frictionBps: number; // round trip incl. simulated cost
  /** Optional shadow-fill simulation result. */
  shadowFill?: { expectedOut: number; simulatedOut: number };
  /** Whether this is a forced safety exit (bypasses net-edge only). */
  forcedSafetyExit?: boolean;
  /** Whether this is the sanctioned stable↔stable compliance scout. */
  isMicroScout?: boolean;
}

export interface RiskGateState {
  portfolioValueUsd: number;
  windowDrawdownPct: number;
  dailyDrawdownPct: number;
  openPositions: number;
  tradesToday: number;
  calibrationStale: boolean;
  marketDataStale: boolean;
  survivalMode: boolean;
}

export interface RiskGateContext {
  config: RiskConfig;
  allowlist: EligibleAllowlist;
  allowedRouters?: readonly string[];
  allowedSpenders?: readonly string[];
}

export interface RiskGateResult {
  approved: boolean;
  rejectCode?: RejectCode;
  reasons: string[];
  passedGates: string[];
}

export function evaluateRiskGates(
  candidate: RiskGateCandidate,
  state: RiskGateState,
  ctx: RiskGateContext,
): RiskGateResult {
  const passedGates: string[] = [];
  const { config } = ctx;

  const reject = (rejectCode: RejectCode, reason: string): RiskGateResult => ({
    approved: false,
    rejectCode,
    reasons: [reason],
    passedGates,
  });

  // Spot-only assertion.
  if (candidate.isNonSpot) {
    return reject(RejectCode.NON_SPOT, "route implies leverage/perp/margin — spot only");
  }
  passedGates.push("spot_only");

  // Chain pinning.
  if (candidate.chainId !== COMPETITION.requiredChainId) {
    return reject(
      RejectCode.WRONG_CHAIN,
      `chainId ${candidate.chainId} != required ${COMPETITION.requiredChainId}`,
    );
  }
  passedGates.push("chain_id");

  // Router allowlist.
  const routers = ctx.allowedRouters ?? COMPETITION.allowedRouters;
  if (!routers.includes(candidate.router)) {
    return reject(RejectCode.ROUTER_NOT_ALLOWED, `router ${candidate.router} not allowlisted`);
  }
  passedGates.push("router");

  // Spender allowlist (when configured).
  if (ctx.allowedSpenders && !ctx.allowedSpenders.includes(candidate.spender)) {
    return reject(RejectCode.SPENDER_NOT_ALLOWED, `spender ${candidate.spender} not allowlisted`);
  }
  passedGates.push("spender");

  // Eligible-contract assertion (both legs, no native/WBNB held).
  const legs = assertLegsEligible(
    candidate.tokenInAddress,
    candidate.tokenOutAddress,
    ctx.allowlist,
  );
  if (!legs.ok) {
    return reject(legs.rejectCode!, legs.reason);
  }
  passedGates.push("eligible_contracts");

  // Approval hygiene.
  if (candidate.isInfiniteApproval && !config.allowInfiniteApprovals) {
    return reject(RejectCode.INFINITE_APPROVAL, "infinite approval disallowed by default");
  }
  const approvalCap = candidate.mandateAmount * (1 + config.approvalBufferBps / 10_000);
  if (candidate.approvalAmount > approvalCap) {
    return reject(
      RejectCode.INFINITE_APPROVAL,
      `approval ${candidate.approvalAmount} exceeds mandate+buffer ${approvalCap.toFixed(6)}`,
    );
  }
  passedGates.push("approval_hygiene");

  // Stale data / calibration block trades (safety exits excepted).
  if (!candidate.forcedSafetyExit) {
    if (state.marketDataStale) {
      return reject(RejectCode.STALE_DATA, "market data is stale");
    }
    if (state.calibrationStale) {
      return reject(RejectCode.STALE_CALIBRATION, "calibration is stale");
    }
    passedGates.push("freshness");
  }

  // Danger threshold / survival mode (safety exits and scouts still allowed).
  if (
    !candidate.forcedSafetyExit &&
    !candidate.isMicroScout &&
    state.portfolioValueUsd <= config.dangerPortfolioValueUsd
  ) {
    return reject(RejectCode.DANGER_THRESHOLD, "portfolio below danger threshold");
  }
  if (state.survivalMode && !candidate.forcedSafetyExit && !candidate.isMicroScout) {
    return reject(RejectCode.DRAWDOWN_BUDGET, "survival mode blocks new risky entries");
  }

  // Concurrency + daily trade caps (entries only).
  if (!candidate.forcedSafetyExit) {
    if (state.openPositions >= config.maxConcurrentPositions && !candidate.isMicroScout) {
      return reject(RejectCode.MAX_CONCURRENT, "max concurrent positions reached");
    }
    if (state.tradesToday >= config.maxTradesPerDay) {
      return reject(RejectCode.MAX_DAILY_TRADES, "max daily trades reached");
    }
    passedGates.push("trade_limits");
  }

  // Net-edge gate (directional trades only; scouts and safety exits exempt).
  if (!candidate.isMicroScout) {
    const netEdge = evaluateNetEdge({
      expectedMoveBps: candidate.expectedMoveBps,
      frictionBps: candidate.frictionBps,
      netEdgeMinBps: config.netEdgeMinBps,
      forcedSafetyExit: candidate.forcedSafetyExit,
    });
    if (!netEdge.passed) {
      return reject(RejectCode.NET_EDGE, netEdge.reason);
    }
    passedGates.push("net_edge");
  } else {
    passedGates.push("micro_scout_exempt");
  }

  // Shadow-fill guard (when a simulation is provided).
  if (candidate.shadowFill) {
    const shadow = evaluateShadowFill({
      expectedOut: candidate.shadowFill.expectedOut,
      simulatedOut: candidate.shadowFill.simulatedOut,
      toleranceBps: config.shadowFillToleranceBps,
    });
    if (!shadow.passed) {
      return reject(RejectCode.SHADOW_FILL, shadow.reason);
    }
    passedGates.push("shadow_fill");
  }

  return { approved: true, reasons: ["all gates passed"], passedGates };
}
