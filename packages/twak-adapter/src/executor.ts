/**
 * TWAK executor interface and the policy-enforcing wrapper.
 *
 * The real TWAK SDK surfaces (local signing, autonomous mode, x402, the
 * `twak compete register` / `competition_register` action) are NOT verified in
 * this environment, so the default executor fails loudly with a clear TODO rather
 * than faking signatures, tx hashes, or receipts. The PolicyEnforcingExecutor
 * wraps ANY real executor and refuses to sign unless the local policy passes —
 * the refusal happens before signing, so a bad intent never reaches the key.
 */

import { EligibleAllowlist } from "@wardenclaw/core";
import type { RegistrationResult, TwakIntent, TwakReceipt, X402Receipt } from "./types.js";
import {
  evaluateTwakPolicy,
  type TwakPolicyConfig,
  type TwakPolicyResult,
  type TwakPolicyState,
} from "./policy.js";

/** The raw TWAK execution surface. Implemented by the real SDK binding. */
export interface TwakExecutor {
  readonly configured: boolean;
  /** Resolve the agent's self-custodial wallet address from local TWAK config. */
  resolveAgentWallet(): Promise<string>;
  /** Locally sign and submit a transaction for an approved intent. */
  signAndSubmit(intent: TwakIntent): Promise<TwakReceipt>;
  /** Register the agent wallet on the competition contract. */
  registerForCompetition(contractAddress: string): Promise<RegistrationResult>;
  /** Pay an x402 request and return the receipt. */
  payX402(req: { url: string; maxAmount: string; asset: string }): Promise<X402Receipt>;
}

const NOT_CONFIGURED =
  "TWAK is not configured. Set TWAK_CONFIG_PATH/TWAK_AGENT_WALLET and provide a real " +
  "Trust Wallet Agent Kit binding. WARDENCLAW never fakes signatures, tx hashes, or " +
  "receipts — execution fails loudly until TWAK is wired.";

/** The default executor: every call fails loudly. Self-custody, no fakes. */
export class UnconfiguredTwakExecutor implements TwakExecutor {
  readonly configured = false;
  async resolveAgentWallet(): Promise<string> {
    throw new Error(NOT_CONFIGURED);
  }
  async signAndSubmit(_intent: TwakIntent): Promise<TwakReceipt> {
    throw new Error(NOT_CONFIGURED);
  }
  async registerForCompetition(_contractAddress: string): Promise<RegistrationResult> {
    throw new Error(NOT_CONFIGURED);
  }
  async payX402(_req: { url: string; maxAmount: string; asset: string }): Promise<X402Receipt> {
    throw new Error(NOT_CONFIGURED);
  }
}

export interface TwakExecutionOutcome {
  policy: TwakPolicyResult;
  /** Present only when policy approved AND signing succeeded. */
  receipt?: TwakReceipt;
  /** True when TWAK refused at the policy layer (before signing). */
  refused: boolean;
}

/**
 * Wraps a real executor with the local policy. The constitution upstream already
 * vetoed bad strategy; this is the final self-custody guardrail at the signer.
 */
export class PolicyEnforcingExecutor {
  constructor(
    private readonly inner: TwakExecutor,
    private readonly allowlist: EligibleAllowlist,
    private readonly config: TwakPolicyConfig,
  ) {}

  /** Evaluate policy and, only if approved, sign+submit through the real executor. */
  async execute(intent: TwakIntent, state?: TwakPolicyState): Promise<TwakExecutionOutcome> {
    const policy = evaluateTwakPolicy(intent, this.allowlist, this.config, state);
    if (!policy.approved) {
      return { policy, refused: true };
    }
    const receipt = await this.inner.signAndSubmit(intent);
    return { policy, receipt, refused: false };
  }

  /** Policy-only check, used by the refusal demo (no signing attempted). */
  check(intent: TwakIntent, state?: TwakPolicyState): TwakPolicyResult {
    return evaluateTwakPolicy(intent, this.allowlist, this.config, state);
  }
}
