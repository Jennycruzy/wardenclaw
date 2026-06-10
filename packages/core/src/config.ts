/**
 * Deterministic, configurable risk parameters.
 *
 * These are the values the risk engine enforces at execution time. They can be
 * configured (via env / strategy JSON) but are non-negotiable once a mandate is
 * evaluated — the LLM cannot bypass them. Defaults target a ~$40 spot-only book
 * on the verified BNB competition rules.
 */

export interface RiskConfig {
  // Capital & sizing ($40 book)
  startingCapitalUsd: number;
  gasReserveUsd: number; // native BNB for gas only — not portfolio capital
  maxConcurrentPositions: number;
  perTradeRiskPct: number; // volatility-stop-derived sizing
  stopAtrMultiple: number;
  maxPositionPct: number;
  attackNotionalMinUsd: number;
  microScoutUsd: number; // stable↔stable compliance trade

  // Trade frequency (verified minimum: 1/day, 7/week)
  minTradesPerDay: number;
  targetTradesPerDay: number;
  maxTradesPerDay: number;

  // Drawdown / survival — three layers
  competitionDqDrawdownPct: number; // disqualifier; 30% indicative, confirm with organizer
  internalWindowDrawdownPct: number; // the offense's actual risk budget
  maxDailyDrawdownPct: number;
  softDrawdownPct: number;
  competitionFloorUsd: number; // verified $1 hourly zeroing rule
  dangerPortfolioValueUsd: number;

  // Micro-capital economics + calibration
  netEdgeMinBps: number;
  frictionBudgetBps: number;
  scoringSimCostBps: number; // per trade leg — conservative default until confirmed
  maxSlippageBps: number;
  shadowFillToleranceBps: number;
  kellyFraction: number;
  calibrationMaxAgeDays: number;

  // Approval safety
  allowInfiniteApprovals: boolean;
  approvalBufferBps: number;
}

/** Authoritative defaults. Conservative open-item values are baked in. */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  startingCapitalUsd: 40,
  gasReserveUsd: 2,
  maxConcurrentPositions: 1,
  perTradeRiskPct: 3,
  stopAtrMultiple: 1.5,
  maxPositionPct: 70,
  attackNotionalMinUsd: 15,
  microScoutUsd: 5,

  minTradesPerDay: 1,
  targetTradesPerDay: 2,
  maxTradesPerDay: 3,

  competitionDqDrawdownPct: 30,
  internalWindowDrawdownPct: 15,
  maxDailyDrawdownPct: 6,
  softDrawdownPct: 4,
  competitionFloorUsd: 1.0,
  dangerPortfolioValueUsd: 8,

  netEdgeMinBps: 30,
  frictionBudgetBps: 120,
  scoringSimCostBps: 10,
  maxSlippageBps: 50,
  shadowFillToleranceBps: 40,
  kellyFraction: 0.25,
  calibrationMaxAgeDays: 7,

  allowInfiniteApprovals: false,
  approvalBufferBps: 50,
};

/** Verified competition constants. */
export const COMPETITION = {
  contractAddress: "0x212c61b9b72c95d95bf29cf032f5e5635629aed5",
  requiredChainId: 56,
  executionType: "spot_only" as const,
  allowedRouters: ["pancakeswap"] as const,
  tradingWindow: { startUtc: "2026-06-22T00:00:00Z", endUtc: "2026-06-28T23:59:59Z" },
  minTradesPerDay: 1,
  minTradesPerWeek: 7,
} as const;

/**
 * Load a RiskConfig from a partial env-derived map, applying defaults for any
 * missing key. Unknown keys are ignored. Numeric parsing is strict: a present
 * but non-numeric value throws rather than silently falling back (fail loud).
 */
export function loadRiskConfig(env: Record<string, string | undefined> = {}): RiskConfig {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid numeric env ${key}=${raw}`);
    }
    return parsed;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    return raw === "true" || raw === "1";
  };

  const d = DEFAULT_RISK_CONFIG;
  return {
    startingCapitalUsd: num("STARTING_CAPITAL_USD", d.startingCapitalUsd),
    gasReserveUsd: num("GAS_RESERVE_USD", d.gasReserveUsd),
    maxConcurrentPositions: num("MAX_CONCURRENT_POSITIONS", d.maxConcurrentPositions),
    perTradeRiskPct: num("PER_TRADE_RISK_PCT", d.perTradeRiskPct),
    stopAtrMultiple: num("STOP_ATR_MULTIPLE", d.stopAtrMultiple),
    maxPositionPct: num("MAX_POSITION_PCT", d.maxPositionPct),
    attackNotionalMinUsd: num("ATTACK_NOTIONAL_MIN_USD", d.attackNotionalMinUsd),
    microScoutUsd: num("MICRO_SCOUT_USD", d.microScoutUsd),

    minTradesPerDay: num("MIN_TRADES_PER_DAY", d.minTradesPerDay),
    targetTradesPerDay: num("TARGET_TRADES_PER_DAY", d.targetTradesPerDay),
    maxTradesPerDay: num("MAX_TRADES_PER_DAY", d.maxTradesPerDay),

    competitionDqDrawdownPct: num("COMPETITION_DQ_DRAWDOWN_PCT", d.competitionDqDrawdownPct),
    internalWindowDrawdownPct: num("INTERNAL_WINDOW_DRAWDOWN_PCT", d.internalWindowDrawdownPct),
    maxDailyDrawdownPct: num("MAX_DAILY_DRAWDOWN_PCT", d.maxDailyDrawdownPct),
    softDrawdownPct: num("SOFT_DRAWDOWN_PCT", d.softDrawdownPct),
    competitionFloorUsd: num("COMPETITION_FLOOR_USD", d.competitionFloorUsd),
    dangerPortfolioValueUsd: num("DANGER_PORTFOLIO_VALUE_USD", d.dangerPortfolioValueUsd),

    netEdgeMinBps: num("NET_EDGE_MIN_BPS", d.netEdgeMinBps),
    frictionBudgetBps: num("FRICTION_BUDGET_BPS", d.frictionBudgetBps),
    scoringSimCostBps: num("SCORING_SIM_COST_BPS", d.scoringSimCostBps),
    maxSlippageBps: num("MAX_SLIPPAGE_BPS", d.maxSlippageBps),
    shadowFillToleranceBps: num("SHADOW_FILL_TOLERANCE_BPS", d.shadowFillToleranceBps),
    kellyFraction: num("KELLY_FRACTION", d.kellyFraction),
    calibrationMaxAgeDays: num("CALIBRATION_MAX_AGE_DAYS", d.calibrationMaxAgeDays),

    allowInfiniteApprovals: bool("ALLOW_INFINITE_APPROVALS", d.allowInfiniteApprovals),
    approvalBufferBps: num("APPROVAL_BUFFER_BPS", d.approvalBufferBps),
  };
}
