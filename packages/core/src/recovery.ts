/**
 * Crash-recovery reconciliation. On every start, before any new trade, the agent
 * must reconcile in-flight transactions against on-chain state so it never
 * duplicates a trade. This module is pure logic over an injected chain lookup;
 * the worker supplies the real RPC query.
 */

export interface PendingMandate {
  mandateId: string;
  /** Present once a tx was submitted; absent means never broadcast. */
  txHash?: string;
  status: "submitted" | "pending_build" | "unknown";
  /** Nonce used for the submitted tx, if any. */
  nonce?: number;
}

export interface ChainTxState {
  found: boolean;
  confirmed: boolean;
  success?: boolean;
}

export type ChainTxLookup = (txHash: string) => Promise<ChainTxState>;

export interface RecoveryResolution {
  mandateId: string;
  resolution:
    | "confirmed_filled"
    | "confirmed_failed"
    | "not_found_safe_to_retry"
    | "needs_manual_review"
    | "never_broadcast";
  detail: string;
}

export interface RecoveryReport {
  resolutions: RecoveryResolution[];
  duplicatesPrevented: number;
  /** True when at least one mandate needs human review before trading resumes. */
  requiresReview: boolean;
}

/**
 * Reconcile pending mandates. Submitted-but-unconfirmed txs are resolved by
 * querying the chain, never by blind re-submission. Re-used nonces flag a
 * potential duplicate and require review.
 */
export async function reconcile(
  pending: PendingMandate[],
  lookup: ChainTxLookup,
): Promise<RecoveryReport> {
  const resolutions: RecoveryResolution[] = [];
  let duplicatesPrevented = 0;
  let requiresReview = false;

  const seenNonces = new Set<number>();

  for (const m of pending) {
    if (!m.txHash) {
      resolutions.push({
        mandateId: m.mandateId,
        resolution: "never_broadcast",
        detail: "no txHash recorded; safe to re-evaluate as a fresh candidate",
      });
      continue;
    }

    if (m.nonce !== undefined) {
      if (seenNonces.has(m.nonce)) {
        duplicatesPrevented++;
        requiresReview = true;
        resolutions.push({
          mandateId: m.mandateId,
          resolution: "needs_manual_review",
          detail: `duplicate nonce ${m.nonce} across pending mandates`,
        });
        continue;
      }
      seenNonces.add(m.nonce);
    }

    const state = await lookup(m.txHash);
    if (state.found && state.confirmed) {
      resolutions.push({
        mandateId: m.mandateId,
        resolution: state.success ? "confirmed_filled" : "confirmed_failed",
        detail: `tx ${m.txHash} confirmed (success=${state.success ?? false})`,
      });
    } else if (state.found && !state.confirmed) {
      requiresReview = true;
      resolutions.push({
        mandateId: m.mandateId,
        resolution: "needs_manual_review",
        detail: `tx ${m.txHash} seen but unconfirmed; wait, do not resubmit`,
      });
    } else {
      resolutions.push({
        mandateId: m.mandateId,
        resolution: "not_found_safe_to_retry",
        detail: `tx ${m.txHash} not found on chain; never landed, safe to re-evaluate`,
      });
    }
  }

  return { resolutions, duplicatesPrevented, requiresReview };
}
