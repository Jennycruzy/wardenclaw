/**
 * TWAK local signing policy — the self-custody guardrail enforced at the moment
 * of signing, independent of (and in addition to) the upstream Risk Constitution.
 *
 * This is the "TWAK refuses a bad trade" layer (§5.4a): TWAK signs ONLY if this
 * local policy passes. It re-asserts the safety-critical invariants — chain 56,
 * spot-only, allowlisted router/spender/contract, both legs on the eligible
 * address-keyed list, no infinite approvals, per-trade and daily spend caps,
 * slippage cap, and that the decoded action matches the approved mandate. Every
 * refusal carries a deterministic reject code.
 */

import { RejectCode, type SignalMandate } from "@wardenclaw/core";
import { assertLegsEligible, EligibleAllowlist } from "@wardenclaw/core";
import type { TwakIntent } from "./types.js";

/** TWAK-specific reject codes layered on top of the core set. */
export const TwakRejectCode = {
  OVER_MAX_TRADE: "REJECT_OVER_MAX_TRADE",
  OVER_DAILY_SPEND: "REJECT_OVER_DAILY_SPEND",
  CONTRACT_NOT_ALLOWED: "REJECT_CONTRACT_NOT_ALLOWED",
  ACTION_MISMATCH: "REJECT_ACTION_MISMATCH",
  PAPER_INTENT_LIVE: "REJECT_PAPER_INTENT_LIVE",
} as const;
export type TwakRejectCode = (typeof TwakRejectCode)[keyof typeof TwakRejectCode];

export interface TwakPolicyConfig {
  requiredChainId: number;
  allowedRouters: readonly string[];
  /** Empty array = skip the spender allowlist check. */
  allowedSpenders: readonly string[];
  /** Empty array = skip the tx.to contract allowlist check. */
  allowedContracts: readonly string[];
  maxTradeUsd: number;
  maxDailySpendUsd: number;
  maxSlippageBps: number;
  allowInfiniteApprovals: boolean;
  approvalBufferBps: number;
}

export interface TwakPolicyState {
  /** USD already spent today across executed trades. */
  spentTodayUsd: number;
}

export interface TwakPolicyResult {
  approved: boolean;
  rejectCode?: string;
  reason: string;
  passedChecks: string[];
}

const norm = (s: string) => s.toLowerCase();

export function evaluateTwakPolicy(
  intent: TwakIntent,
  allowlist: EligibleAllowlist,
  config: TwakPolicyConfig,
  state: TwakPolicyState = { spentTodayUsd: 0 },
): TwakPolicyResult {
  const passedChecks: string[] = [];
  const refuse = (rejectCode: string, reason: string): TwakPolicyResult => ({
    approved: false,
    rejectCode,
    reason,
    passedChecks,
  });

  // Live execution is spot-only; a paper intent must never reach the live signer.
  if (intent.executionType !== "spot_only") {
    return refuse(TwakRejectCode.PAPER_INTENT_LIVE, "non-spot_only intent presented to live signer");
  }
  passedChecks.push("execution_type");

  // Spot-only: any leverage/perp/margin route is refused.
  if (intent.isNonSpot) {
    return refuse(RejectCode.NON_SPOT, "route implies leverage/perp/margin — TWAK refuses");
  }
  passedChecks.push("spot_only");

  // Chain pinning.
  if (intent.chainId !== config.requiredChainId) {
    return refuse(RejectCode.WRONG_CHAIN, `chainId ${intent.chainId} != ${config.requiredChainId}`);
  }
  passedChecks.push("chain_id");

  // Router allowlist.
  if (!config.allowedRouters.map(norm).includes(norm(intent.router))) {
    return refuse(RejectCode.ROUTER_NOT_ALLOWED, `router ${intent.router} not allowlisted`);
  }
  passedChecks.push("router");

  // Spender allowlist (when configured).
  if (config.allowedSpenders.length > 0 && !config.allowedSpenders.map(norm).includes(norm(intent.spender))) {
    return refuse(RejectCode.SPENDER_NOT_ALLOWED, `spender ${intent.spender} not allowlisted`);
  }
  passedChecks.push("spender");

  // tx.to contract allowlist (when configured).
  if (config.allowedContracts.length > 0 && !config.allowedContracts.map(norm).includes(norm(intent.to))) {
    return refuse(TwakRejectCode.CONTRACT_NOT_ALLOWED, `tx.to ${intent.to} not allowlisted`);
  }
  passedChecks.push("contract");

  // Eligible-contract assertion for swaps (both held legs; no native/WBNB held).
  if (intent.kind === "swap") {
    const legs = assertLegsEligible(intent.tokenInAddress, intent.tokenOutAddress, allowlist);
    if (!legs.ok) return refuse(legs.rejectCode!, legs.reason);
    passedChecks.push("eligible_contracts");
  }

  // Approval hygiene.
  if (intent.isInfiniteApproval && !config.allowInfiniteApprovals) {
    return refuse(RejectCode.INFINITE_APPROVAL, "infinite approval disallowed by default");
  }
  if (intent.approvalAmount !== undefined && intent.mandateAmount !== undefined) {
    const cap = intent.mandateAmount * (1 + config.approvalBufferBps / 10_000);
    if (intent.approvalAmount > cap) {
      return refuse(
        RejectCode.INFINITE_APPROVAL,
        `approval ${intent.approvalAmount} exceeds mandate+buffer ${cap.toFixed(6)}`,
      );
    }
  }
  passedChecks.push("approval_hygiene");

  // Slippage cap.
  if (intent.slippageBps > config.maxSlippageBps) {
    return refuse(RejectCode.SLIPPAGE, `slippage ${intent.slippageBps}bps > cap ${config.maxSlippageBps}bps`);
  }
  passedChecks.push("slippage");

  // Per-trade spend cap.
  if (intent.amountInUsd > config.maxTradeUsd) {
    return refuse(TwakRejectCode.OVER_MAX_TRADE, `trade $${intent.amountInUsd} > max $${config.maxTradeUsd}`);
  }
  passedChecks.push("max_trade");

  // Daily spend cap.
  if (state.spentTodayUsd + intent.amountInUsd > config.maxDailySpendUsd) {
    return refuse(
      TwakRejectCode.OVER_DAILY_SPEND,
      `daily spend ${(state.spentTodayUsd + intent.amountInUsd).toFixed(2)} > cap ${config.maxDailySpendUsd}`,
    );
  }
  passedChecks.push("daily_spend");

  // The decoded action must match what the approved mandate authorized.
  if (intent.decodedAction !== intent.mandateAction) {
    return refuse(
      TwakRejectCode.ACTION_MISMATCH,
      `decoded action "${intent.decodedAction}" != mandate action "${intent.mandateAction}"`,
    );
  }
  passedChecks.push("action_match");

  return { approved: true, reason: "TWAK local policy passed — safe to sign", passedChecks };
}

/** Build a TWAK swap intent from an approved mandate + execution parameters. */
export function intentFromMandate(
  mandate: SignalMandate,
  params: {
    router: string;
    spender: string;
    to: string;
    tokenInAddress: string;
    tokenOutAddress: string;
    amountInUsd: number;
    approvalAmount?: number;
    mandateAmount?: number;
    slippageBps: number;
    decodedAction: string;
  },
): TwakIntent {
  return {
    kind: "swap",
    chainId: 56,
    executionType: "spot_only",
    router: params.router,
    spender: params.spender,
    to: params.to,
    tokenInAddress: params.tokenInAddress,
    tokenOutAddress: params.tokenOutAddress,
    amountInUsd: params.amountInUsd,
    txValueWei: "0",
    isInfiniteApproval: false,
    approvalAmount: params.approvalAmount,
    mandateAmount: params.mandateAmount,
    slippageBps: params.slippageBps,
    isNonSpot: false,
    decodedAction: params.decodedAction,
    mandateAction: mandate.action,
    mandateId: mandate.id,
  };
}
