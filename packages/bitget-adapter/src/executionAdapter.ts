/**
 * Bitget execution adapter selection.
 *
 * Priority (§4.3):
 *   1. Official Bitget demo trading API — ONLY if verified working.
 *   2. Internal paper engine fed by real Bitget market data.
 *   3. Backtest.
 * Internal paper fills are never presented as Bitget exchange fills; the chosen
 * mode is always surfaced. The official-demo adapter lives in demoExecutor.ts:
 * it trades Bitget's real Demo Trading environment via the Agent Hub MCP server
 * (--paper-trading) and activates only with a complete Demo API credential set.
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

/** The internal paper executor is simply a PaperBook with the mode attached. */
export class InternalPaperExecutor {
  readonly mode = "internal_paper_engine" as const;
  constructor(readonly book: PaperBook) {}
}
