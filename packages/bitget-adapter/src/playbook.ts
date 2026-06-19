/**
 * Playbook Shield wiring for the Bitget pipeline.
 *
 * Position in the pipeline:
 *   strategy → Playbook Shield → (Restricted caps) → StrategyCompilerAgent → Signal Mandates
 *
 * This is the enforcement seam that makes the Shield's verdict real:
 *   - Rejected  → compilation NEVER runs; no compiled strategy, so no mandates.
 *   - Restricted→ the compiler runs under the Shield's tightened caps (the manual
 *                 fallback and the clamp both consume the lowered numbers).
 *   - Certified → the compiler runs under the normal reactor-derived caps.
 *
 * The Shield is run against the SAME base caps the Bitget compiler would use, so
 * the adjusted caps are tightenings of the real pipeline limits, not a parallel set.
 */

import {
  auditStrategy,
  type AuditStrategyResult,
  type PlaybookShieldConfig,
  type RiskConfig,
  type LlmProvider,
} from "@wardenclaw/core";
import { bitgetRiskConfig, compileBitgetStrategy, type CompileBitgetStrategyResult } from "./strategy.js";
import type { ReactorConfig } from "./reactor.js";

export interface AuditAndCompileInput {
  /** Natural-language strategy text to audit. */
  strategy: string;
  reactor: ReactorConfig;
  provider?: LlmProvider;
  shieldConfig?: PlaybookShieldConfig;
  /** Optional backtest artifact enabling the conditional overfit check. */
  backtest?: { closedTrades: number };
  /** Strategy Safety Card chain + signing. */
  prevCardHash?: string;
  signingKey?: string;
  nowIso?: string;
  expiresAtIso?: string;
}

export interface AuditAndCompileResult {
  audit: AuditStrategyResult;
  /** The verdict's strategy verdict, surfaced for convenience. */
  verdict: AuditStrategyResult["verdict"];
  /** True only when the strategy was allowed to compile (not Rejected). */
  compiled: boolean;
  /** The compiled strategy — ABSENT when Rejected (no mandates may be generated). */
  strategy?: CompileBitgetStrategyResult;
  /** The exact caps the compiler ran under (the Warden-adjusted RiskConfig). */
  compiledUnder?: RiskConfig;
}

/**
 * Audit a strategy through the Playbook Shield and, only if it may emit mandates,
 * compile it under the Warden-adjusted caps.
 */
export async function auditAndCompileBitgetStrategy(
  input: AuditAndCompileInput,
): Promise<AuditAndCompileResult> {
  const baseConfig = bitgetRiskConfig({
    naturalLanguageIntent: input.strategy,
    reactor: input.reactor,
  });

  const audit = auditStrategy({
    strategy: input.strategy,
    baseConfig,
    ...(input.shieldConfig ? { shieldConfig: input.shieldConfig } : {}),
    ...(input.backtest ? { backtest: input.backtest } : {}),
    ...(input.prevCardHash ? { prevCardHash: input.prevCardHash } : {}),
    ...(input.signingKey ? { signingKey: input.signingKey } : {}),
    ...(input.nowIso ? { nowIso: input.nowIso } : {}),
    ...(input.expiresAtIso ? { expiresAtIso: input.expiresAtIso } : {}),
  });

  // Rejected: fail-closed. No compilation, no mandates.
  if (!audit.mayEmitMandates) {
    return { audit, verdict: audit.verdict, compiled: false };
  }

  // Certified runs under base caps; Restricted runs under the tightened caps.
  const compiledUnder = audit.caps.risk;
  const strategy = await compileBitgetStrategy({
    naturalLanguageIntent: input.strategy,
    reactor: input.reactor,
    riskConfigOverride: compiledUnder,
    ...(input.provider ? { provider: input.provider } : {}),
  });

  return { audit, verdict: audit.verdict, compiled: true, strategy, compiledUnder };
}
