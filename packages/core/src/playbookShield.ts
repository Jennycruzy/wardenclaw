/**
 * Playbook Shield — the pre-flight strategy auditor (checkpoint 1).
 *
 * A strategy must pass the Shield BEFORE WardenClaw lets it generate Signal
 * Mandates. The Shield reuses the trade-verdict semantics (three strategy
 * verdicts that mirror APPROVE / REDUCE / BLOCK) and feeds the existing strategy
 * compiler clamp — it is not a parallel risk engine.
 *
 *   Certified  (≈ APPROVE) — safe as written; may emit mandates under base caps.
 *   Restricted (≈ REDUCE)  — may emit mandates, but only under TIGHTENED caps;
 *                            those caps ARE the clamp config handed to the compiler,
 *                            so Restriction actually rewrites the limits the
 *                            downstream pipeline runs under.
 *   Rejected   (≈ BLOCK)   — no mandates are generated. Period.
 *
 * Five deterministic static checks, parseable from strategy text (no statistics):
 *   1. Leverage scanner            — over hard cap ⇒ Restrict (clamp); extreme ⇒ Reject.
 *   2. Martingale / loss-doubling  — ⇒ Reject (the headline danger; never clamped through).
 *   3. Missing daily-drawdown cap  — ⇒ Restrict (inject the default cap).
 *   4. Missing post-shock cooldown — ⇒ Restrict (inject cooldown).
 *   5. Earnings / first-spike entry without confirmation — ⇒ Restrict (attach
 *      confirmation) or Reject if it explicitly mandates entering without it.
 *
 * The verdict is deterministic: any Reject ⇒ Rejected; else any Restrict ⇒
 * Restricted; else Certified. The LLM never participates in this decision.
 */

import type { RiskConfig } from "./config.js";
import { DEFAULT_RISK_CONFIG } from "./config.js";
import { sealCard, sha256Canonical, type SignedCard } from "./wardenCard.js";

export type StrategyVerdict = "Certified" | "Restricted" | "Rejected";

export type PlaybookCheckName =
  | "leverage"
  | "martingale"
  | "daily_drawdown"
  | "cooldown"
  | "earnings_first_spike"
  | "min_closed_trades";

export type CheckEffect = "none" | "restrict" | "reject";

export interface PlaybookCheck {
  check: PlaybookCheckName;
  passed: boolean;
  value: string | number;
  threshold: string | number;
  effect: CheckEffect;
  note: string;
}

/** Thresholds the static checks enforce. All overridable; conservative defaults. */
export interface PlaybookShieldConfig {
  /** Leverage above this ⇒ Restrict (clamp down to it). */
  hardMaxLeverage: number;
  /** Leverage at/above this ⇒ Reject outright (too extreme to clamp). */
  extremeLeverage: number;
  /** Conservative sizing a Restricted strategy runs under (clamp config). */
  restrictedMaxPositionPct: number;
  restrictedPerTradeRiskPct: number;
  /** Daily-drawdown cap injected when the strategy declares none. */
  injectedMaxDailyDrawdownPct: number;
  /** Post-shock cooldown (bars) injected when the strategy declares none. */
  injectedCooldownBars: number;
  /** Min closed trades for the conditional overfit check (backtest artifact only). */
  minClosedTrades: number;
}

export const DEFAULT_PLAYBOOK_CONFIG: PlaybookShieldConfig = {
  hardMaxLeverage: 3,
  extremeLeverage: 5,
  restrictedMaxPositionPct: 35,
  restrictedPerTradeRiskPct: 1.5,
  injectedMaxDailyDrawdownPct: DEFAULT_RISK_CONFIG.maxDailyDrawdownPct,
  injectedCooldownBars: 3,
  minClosedTrades: 20,
};

/** The Warden-adjusted caps a passing strategy emits mandates under. */
export interface PlaybookCaps {
  /** The clamp config handed to the strategy compiler (it clamps to these). */
  risk: RiskConfig;
  /** Hard leverage ceiling enforced by the Trade-Permit Engine. */
  maxLeverage: number;
  /** Post-shock cooldown bars the pipeline must honor. */
  cooldownBars: number;
  /** Whether a post-news/first-spike confirmation candle is required. */
  requireConfirmation: boolean;
}

export interface StrategySafetyCardBody {
  subject: "strategy_safety";
  strategy_hash: string;
  verdict: StrategyVerdict;
  may_emit_mandates: boolean;
  failed_checks: PlaybookCheck[];
  warden_adjusted_caps: {
    maxPositionPct: number;
    perTradeRiskPct: number;
    maxConcurrentPositions: number;
    maxDailyTrades: number;
    maxSlippageBps: number;
    stopAtrMultiple: number;
    netEdgeMinBps: number;
    maxDailyDrawdownPct: number;
    maxLeverage: number;
    cooldownBars: number;
    requireConfirmation: boolean;
  };
  created_at: string;
  expires_at: string;
}

export type StrategySafetyCard = SignedCard<StrategySafetyCardBody>;

export interface AuditStrategyInput {
  /** Natural-language strategy text. */
  strategy: string;
  /** Base hard caps (the compiler's normal clamp config). */
  baseConfig?: RiskConfig;
  shieldConfig?: PlaybookShieldConfig;
  /** Optional backtest artifact enabling the conditional 6th check. */
  backtest?: { closedTrades: number };
  /** Card chain + signing. */
  prevCardHash?: string;
  signingKey?: string;
  /** Injected for deterministic tests; defaults to now / now+15min. */
  nowIso?: string;
  expiresAtIso?: string;
}

export interface AuditStrategyResult {
  verdict: StrategyVerdict;
  mayEmitMandates: boolean;
  checks: PlaybookCheck[];
  failedChecks: PlaybookCheck[];
  caps: PlaybookCaps;
  card: StrategySafetyCard;
}

// ---- parsing helpers (deterministic, text-only) -------------------------------

/** Highest leverage referenced in the text (e.g. "5x", "leverage 8"); 1 if none. */
function parseLeverage(text: string): number {
  let max = 1;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*x\b/gi)) max = Math.max(max, Number(m[1]));
  for (const m of text.matchAll(/leverage\s*(?:of|:|=|at)?\s*(\d+(?:\.\d+)?)/gi)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

function hasMartingale(text: string): boolean {
  return (
    /martingale/i.test(text) ||
    /average\s+down/i.test(text) ||
    /\b(double|triple|increase|grow|scale|add)\b[^.]{0,40}\b(after|on|following|into)\b[^.]{0,20}\bloss(es|ing)?\b/i.test(
      text,
    ) ||
    /\b(after|on|following)\b[^.]{0,20}\bloss(es|ing)?\b[^.]{0,40}\b(double|increase|bigger|larger|add\s+to)\b/i.test(
      text,
    ) ||
    /\badd(?:ing)?\s+to\s+(?:a\s+)?los/i.test(text)
  );
}

function hasDailyDrawdownCap(text: string): boolean {
  return /\b(daily|per[-\s]?day)\b[^.]{0,30}\b(loss|draw[-\s]?down|stop|limit|cap)\b/i.test(text) ||
    /\bmax(?:imum)?\s+daily\b/i.test(text) ||
    /\bdaily\s+(?:risk\s+)?(?:limit|budget)\b/i.test(text);
}

function hasCooldown(text: string): boolean {
  return /\bcool[-\s]?down\b/i.test(text) ||
    /\bpost[-\s]?(?:event|news|shock)\b/i.test(text) ||
    /\bwait\b[^.]{0,40}\b(news|event|shock|spike|candle|bar)s?\b/i.test(text) ||
    /\b(never|don'?t|do not|avoid)\b[^.]{0,30}\bfirst\b[^.]{0,15}\b(spike|candle|bar)\b/i.test(text);
}

function mentionsEarningsOrFirstSpike(text: string): boolean {
  return /\bearnings\b/i.test(text) || /\bfirst\b[^.]{0,15}\b(spike|candle|bar)\b/i.test(text) ||
    /\b(chase|chasing)\b[^.]{0,20}\b(spike|breakout|pump|news)\b/i.test(text);
}

function hasConfirmation(text: string): boolean {
  return /\bconfirm(?:ation|ed|s)?\b/i.test(text) ||
    /\bvolume\b[^.]{0,20}\b(confirm|support)\b/i.test(text) ||
    /\b(second|two|2)\b[^.]{0,15}\bcandles?\b/i.test(text);
}

function explicitlyWithoutConfirmation(text: string): boolean {
  return /\b(immediately|instantly|right away|at once)\b/i.test(text) ||
    /\bwithout\b[^.]{0,20}\bconfirm/i.test(text) ||
    /\b(ignore|skip|no)\b[^.]{0,15}\bconfirm/i.test(text) ||
    /\bchase\b/i.test(text);
}

// ---- the five (+1 conditional) checks -----------------------------------------

function runChecks(input: AuditStrategyInput, cfg: PlaybookShieldConfig): PlaybookCheck[] {
  const text = input.strategy;
  const checks: PlaybookCheck[] = [];

  // 1. Leverage scanner.
  const lev = parseLeverage(text);
  if (lev >= cfg.extremeLeverage) {
    checks.push({
      check: "leverage", passed: false, value: lev, threshold: cfg.extremeLeverage,
      effect: "reject", note: `leverage ${lev}x is extreme (≥ ${cfg.extremeLeverage}x) — rejected, not clamped`,
    });
  } else if (lev > cfg.hardMaxLeverage) {
    checks.push({
      check: "leverage", passed: false, value: lev, threshold: cfg.hardMaxLeverage,
      effect: "restrict", note: `leverage ${lev}x over hard cap ${cfg.hardMaxLeverage}x — clamped down`,
    });
  } else {
    checks.push({
      check: "leverage", passed: true, value: lev, threshold: cfg.hardMaxLeverage,
      effect: "none", note: `leverage ${lev}x within hard cap`,
    });
  }

  // 2. Martingale / loss-doubling.
  const mart = hasMartingale(text);
  checks.push({
    check: "martingale", passed: !mart, value: mart ? "detected" : "none", threshold: "forbidden",
    effect: mart ? "reject" : "none",
    note: mart ? "position-scaling-on-loss detected — rejected outright" : "no loss-scaling pattern",
  });

  // 3. Missing max-daily-drawdown cap.
  const ddOk = hasDailyDrawdownCap(text);
  checks.push({
    check: "daily_drawdown", passed: ddOk, value: ddOk ? "present" : "absent",
    threshold: `${cfg.injectedMaxDailyDrawdownPct}%`,
    effect: ddOk ? "none" : "restrict",
    note: ddOk ? "declares a daily loss limit" : `no daily loss limit — injecting ${cfg.injectedMaxDailyDrawdownPct}%`,
  });

  // 4. Missing post-shock cooldown.
  const cdOk = hasCooldown(text);
  checks.push({
    check: "cooldown", passed: cdOk, value: cdOk ? "present" : "absent",
    threshold: `${cfg.injectedCooldownBars} bars`,
    effect: cdOk ? "none" : "restrict",
    note: cdOk ? "declares a post-shock cooldown" : `no cooldown — injecting ${cfg.injectedCooldownBars} bars`,
  });

  // 5. Earnings-window / first-spike exposure.
  if (mentionsEarningsOrFirstSpike(text)) {
    if (!hasConfirmation(text) && explicitlyWithoutConfirmation(text)) {
      checks.push({
        check: "earnings_first_spike", passed: false, value: "mandates entry without confirmation",
        threshold: "confirmation required", effect: "reject",
        note: "explicitly enters earnings/first-spike with no confirmation — rejected",
      });
    } else if (!hasConfirmation(text)) {
      checks.push({
        check: "earnings_first_spike", passed: false, value: "enters without confirmation",
        threshold: "confirmation required", effect: "restrict",
        note: "earnings/first-spike entry — attaching confirmation requirement",
      });
    } else {
      checks.push({
        check: "earnings_first_spike", passed: true, value: "confirmation present",
        threshold: "confirmation required", effect: "none",
        note: "earnings/first-spike entry already gated on confirmation",
      });
    }
  } else {
    checks.push({
      check: "earnings_first_spike", passed: true, value: "no earnings/first-spike chasing",
      threshold: "confirmation required", effect: "none", note: "no earnings/first-spike exposure",
    });
  }

  // 6. Conditional overfit check — only when a backtest artifact is supplied.
  if (input.backtest) {
    const n = input.backtest.closedTrades;
    const ok = n >= cfg.minClosedTrades;
    checks.push({
      check: "min_closed_trades", passed: ok, value: n, threshold: cfg.minClosedTrades,
      effect: ok ? "none" : "restrict",
      note: ok ? `${n} closed trades ≥ ${cfg.minClosedTrades}` : `only ${n} closed trades — overfit risk, restricting`,
    });
  }

  return checks;
}

function aggregateVerdict(checks: PlaybookCheck[]): StrategyVerdict {
  if (checks.some((c) => c.effect === "reject")) return "Rejected";
  if (checks.some((c) => c.effect === "restrict")) return "Restricted";
  return "Certified";
}

function buildCaps(
  verdict: StrategyVerdict,
  checks: PlaybookCheck[],
  base: RiskConfig,
  cfg: PlaybookShieldConfig,
): PlaybookCaps {
  const risk: RiskConfig = { ...base };
  let maxLeverage = cfg.hardMaxLeverage;
  let cooldownBars = cfg.injectedCooldownBars;
  let requireConfirmation = false;

  if (verdict === "Rejected") {
    // No mandates anyway; still report the would-be conservative caps.
    return {
      risk: { ...risk, maxPositionPct: cfg.restrictedMaxPositionPct, perTradeRiskPct: cfg.restrictedPerTradeRiskPct },
      maxLeverage: cfg.hardMaxLeverage,
      cooldownBars,
      requireConfirmation: true,
    };
  }

  if (verdict === "Restricted") {
    // Any restriction ⇒ the conservative restricted book (compiler clamps to these).
    risk.maxPositionPct = Math.min(risk.maxPositionPct, cfg.restrictedMaxPositionPct);
    risk.perTradeRiskPct = Math.min(risk.perTradeRiskPct, cfg.restrictedPerTradeRiskPct);
    for (const c of checks) {
      if (c.effect !== "restrict") continue;
      if (c.check === "daily_drawdown") {
        risk.maxDailyDrawdownPct = Math.min(risk.maxDailyDrawdownPct, cfg.injectedMaxDailyDrawdownPct);
      }
      if (c.check === "cooldown") cooldownBars = Math.max(cooldownBars, cfg.injectedCooldownBars);
      if (c.check === "earnings_first_spike") requireConfirmation = true;
    }
  }

  return { risk, maxLeverage, cooldownBars, requireConfirmation };
}

/**
 * Audit a strategy through the Playbook Shield. Returns the verdict, the failed
 * checks (with {check, value, threshold}), the Warden-adjusted caps, and a signed,
 * hash-chained Strategy Safety Card.
 */
export function auditStrategy(input: AuditStrategyInput): AuditStrategyResult {
  const cfg = input.shieldConfig ?? DEFAULT_PLAYBOOK_CONFIG;
  const base = input.baseConfig ?? DEFAULT_RISK_CONFIG;

  const checks = runChecks(input, cfg);
  const verdict = aggregateVerdict(checks);
  const mayEmitMandates = verdict !== "Rejected";
  const caps = buildCaps(verdict, checks, base, cfg);

  const createdAt = input.nowIso ?? new Date().toISOString();
  const expiresAt =
    input.expiresAtIso ?? new Date(new Date(createdAt).getTime() + 15 * 60_000).toISOString();
  const strategyHash = sha256Canonical({ strategy: input.strategy.trim() });

  const body: StrategySafetyCardBody = {
    subject: "strategy_safety",
    strategy_hash: strategyHash,
    verdict,
    may_emit_mandates: mayEmitMandates,
    failed_checks: checks.filter((c) => !c.passed),
    warden_adjusted_caps: {
      maxPositionPct: caps.risk.maxPositionPct,
      perTradeRiskPct: caps.risk.perTradeRiskPct,
      maxConcurrentPositions: caps.risk.maxConcurrentPositions,
      maxDailyTrades: caps.risk.maxTradesPerDay,
      maxSlippageBps: caps.risk.maxSlippageBps,
      stopAtrMultiple: caps.risk.stopAtrMultiple,
      netEdgeMinBps: caps.risk.netEdgeMinBps,
      maxDailyDrawdownPct: caps.risk.maxDailyDrawdownPct,
      maxLeverage: caps.maxLeverage,
      cooldownBars: caps.cooldownBars,
      requireConfirmation: caps.requireConfirmation,
    },
    created_at: createdAt,
    expires_at: expiresAt,
  };

  const card = sealCard(body, {
    ...(input.prevCardHash ? { prevCardHash: input.prevCardHash } : {}),
    ...(input.signingKey ? { signingKey: input.signingKey } : {}),
  });

  return { verdict, mayEmitMandates, checks, failedChecks: body.failed_checks, caps, card };
}
