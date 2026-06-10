/**
 * Trust Wallet Agent Kit (TWAK) adapter types.
 *
 * TWAK is the SOLE execution layer for RUNECLAW BSC: local signing, autonomous
 * spot execution, x402 payment, and competition registration. Self-custody is
 * absolute — the private key stays local with TWAK, the backend never signs, and
 * no key is ever stored in a DB. This module models the intents TWAK acts on and
 * the receipts it returns; the real SDK calls live behind the executor interface.
 */

/** The kind of transaction TWAK is being asked to sign. */
export type TwakIntentKind = "swap" | "approval" | "registration";

/** A fully-specified intent presented to the local TWAK policy before signing. */
export interface TwakIntent {
  kind: TwakIntentKind;
  chainId: number;
  /** Always "spot_only" for real BSC execution; perps are never built. */
  executionType: "spot_only" | "paper";
  /** The DEX/router name (e.g. "pancakeswap"). */
  router: string;
  /** The spender the approval/swap authorizes. */
  spender: string;
  /** tx.to — the contract the transaction targets. */
  to: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  /** Notional in USD the intent moves. */
  amountInUsd: number;
  /** Native BNB value attached to the tx, in wei (string for precision). */
  txValueWei: string;
  /** Whether this is (or contains) an unlimited approval. */
  isInfiniteApproval: boolean;
  /** Token units the approval would grant (for approval/swap-with-approval). */
  approvalAmount?: number;
  /** Token units the mandate authorizes. */
  mandateAmount?: number;
  slippageBps: number;
  /** Whether the route implies leverage/perp/margin. Always rejected. */
  isNonSpot: boolean;
  /** The decoded on-chain action TWAK would perform. */
  decodedAction: string;
  /** The action the approved Signal Mandate authorized. Must match. */
  mandateAction: string;
  /** The mandate id this intent settles, for the audit trail. */
  mandateId?: string;
}

/** Result of submitting a signed transaction through TWAK. */
export interface TwakReceipt {
  txHash: string;
  /** TWAK's own action receipt id, if provided by the SDK. */
  twakReceiptId?: string;
  status: "submitted" | "confirmed" | "failed";
  /** Realized output amount, when known post-confirmation. */
  realizedOut?: number;
}

/** Result of an on-chain competition registration. */
export interface RegistrationResult {
  registered: boolean;
  contractAddress: string;
  agentWallet: string;
  registrationTxHash?: string;
  detail: string;
}

/** A single x402 pay-per-request receipt, chained into the mandate. */
export interface X402Receipt {
  requestUrl: string;
  amount: string;
  asset: string;
  payer: string;
  recipient: string;
  receipt: string;
  responseSummary: string;
  mandateId?: string;
  usedInDecision: boolean;
  timestamp: string;
}
