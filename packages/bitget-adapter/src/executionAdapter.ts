/**
 * Bitget execution adapter selection.
 *
 * Priority (§4.3):
 *   1. Official Bitget demo trading API — ONLY if verified working.
 *   2. Internal paper engine fed by real Bitget market data.
 *   3. Backtest.
 * Internal paper fills are never presented as Bitget exchange fills; the chosen
 * mode is always surfaced. The official-demo adapter is intentionally not
 * implemented (unverified) and throws a clear TODO if selected.
 */

import type { BitgetExecutionMode } from "./types.js";
import { PaperBook } from "./paperEngine.js";

export interface ExecutionAdapterSelection {
  mode: BitgetExecutionMode;
  reason: string;
}

export interface SelectExecutionInput {
  /** Whether official Bitget demo trading was verified AND configured. */
  officialDemoVerified: boolean;
  /** Whether we are running a historical backtest rather than live paper. */
  backtest: boolean;
}

export function selectExecutionMode(input: SelectExecutionInput): ExecutionAdapterSelection {
  if (input.backtest) {
    return { mode: "backtest", reason: "backtest run requested" };
  }
  if (input.officialDemoVerified) {
    return {
      mode: "official_bitget_demo",
      reason: "official Bitget demo trading verified and configured",
    };
  }
  return {
    mode: "internal_paper_engine",
    reason:
      "official Bitget demo not verified — using internal paper engine on real Bitget market data",
  };
}

/**
 * The official Bitget demo executor is NOT implemented because the endpoints are
 * unverified in this environment. Selecting it without a real implementation
 * fails loudly rather than silently falling back to fabricated fills.
 */
export class OfficialBitgetDemoExecutor {
  open(): never {
    throw new Error(
      "Official Bitget demo execution is not implemented (endpoints unverified). " +
        "Verify the Bitget demo trading API and implement this adapter, or run with " +
        "the internal paper engine (BITGET_EXECUTION_MODE=internal_paper_engine).",
    );
  }
}

/** The internal paper executor is simply a PaperBook with the mode attached. */
export class InternalPaperExecutor {
  readonly mode = "internal_paper_engine" as const;
  constructor(readonly book: PaperBook) {}
}
