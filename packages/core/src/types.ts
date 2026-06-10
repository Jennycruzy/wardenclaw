/**
 * Shared RUNECLAW types. The SignalMandate is the system's central primitive:
 * every trade is a structured, replayable object carrying perception, decision,
 * economics, risk, execution, watchdog actions, result and proof.
 */

export type Venue = "bitget" | "bsc";
export type MandateMode = "paper" | "backtest" | "live" | "rehearsal";
export type ExecutionType = "spot_only" | "paper";
export type AssetType = "xstock" | "xperp" | "bep20" | "stable";
export type MandateAction =
  | "watch"
  | "enter_long"
  | "exit"
  | "reduce"
  | "hold"
  | "pause";

export type SignalFamily = "momentum" | "catalyst" | "scout" | "safety";
export type RiskClass = "conservative" | "balanced" | "aggressive" | "blocked";
export type ExecutionStatus =
  | "not_submitted"
  | "submitted"
  | "filled"
  | "cancelled"
  | "rejected"
  | "failed";
export type Outcome = "open" | "win" | "loss" | "breakeven" | "skipped";

/**
 * Deterministic reject codes. Every skipped/blocked decision records one of
 * these in the audit trail, with the numbers that produced it.
 */
export const RejectCode = {
  NON_SPOT: "REJECT_NON_SPOT",
  INELIGIBLE_CONTRACT: "REJECT_INELIGIBLE_CONTRACT",
  NET_EDGE: "REJECT_NET_EDGE",
  STOP_COHERENCE: "REJECT_STOP_COHERENCE",
  SHADOW_FILL: "REJECT_SHADOW_FILL",
  WRONG_CHAIN: "REJECT_WRONG_CHAIN",
  ROUTER_NOT_ALLOWED: "REJECT_ROUTER_NOT_ALLOWED",
  SPENDER_NOT_ALLOWED: "REJECT_SPENDER_NOT_ALLOWED",
  INFINITE_APPROVAL: "REJECT_INFINITE_APPROVAL",
  HELD_NATIVE_OR_WBNB: "REJECT_HELD_NATIVE_OR_WBNB",
  DUST_TRADE: "REJECT_DUST_TRADE",
  STALE_DATA: "REJECT_STALE_DATA",
  STALE_CALIBRATION: "REJECT_STALE_CALIBRATION",
  DRAWDOWN_BUDGET: "REJECT_DRAWDOWN_BUDGET",
  DANGER_THRESHOLD: "REJECT_DANGER_THRESHOLD",
  MAX_DAILY_TRADES: "REJECT_MAX_DAILY_TRADES",
  MAX_CONCURRENT: "REJECT_MAX_CONCURRENT",
  STRATEGY_UNCLEAR: "REJECT_STRATEGY_UNCLEAR",
  ADAPTER_UNAVAILABLE: "REJECT_ADAPTER_UNAVAILABLE",
  SLIPPAGE: "REJECT_SLIPPAGE",
} as const;
export type RejectCode = (typeof RejectCode)[keyof typeof RejectCode];

export interface MandatePerception {
  source: string;
  marketData: Record<string, unknown>;
  news?: Record<string, unknown>;
  sentiment?: Record<string, unknown>;
  macro?: Record<string, unknown>;
  technicals?: Record<string, unknown>;
  liquidity?: Record<string, unknown>;
  rawRefs?: string[];
  cmcToolsUsed?: string[];
  marketDataTimestamp?: string;
}

export interface MandateDecision {
  signalFamily: SignalFamily;
  tradeScore: number;
  regime: string;
  reason: string[];
  rejectedReasons?: string[];
}

export interface MandateEconomics {
  frictionBps: number; // includes simulated scoring cost
  realFrictionBps: number;
  simulatedCostBps: number;
  expectedMoveBps: number;
  netEdgePassed: boolean;
  stopDistancePct?: number;
  stopCoherencePassed?: boolean;
  shadowFillDeviationBps?: number;
  calibrationVersion?: string;
}

export interface MandateRisk {
  approved: boolean;
  maxPositionPct: number;
  perTradeRiskPct?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  maxSlippageBps?: number;
  riskClass: RiskClass;
  survivalMode: boolean;
}

export interface MandateExecution {
  adapter: string;
  requestedOrder?: Record<string, unknown>;
  finalOrder?: Record<string, unknown>;
  txHash?: string;
  paperFill?: Record<string, unknown>;
  status: ExecutionStatus;
}

export interface MandateWatchdog {
  armed: boolean;
  triggers: string[];
  actionsTaken: string[];
}

export interface MandateResult {
  pnlPct?: number;
  pnlUsd?: number;
  maxDrawdownPct?: number;
  closedAt?: string;
  outcome: Outcome;
}

export interface MandateProofAnchors {
  bscTxHash?: string;
  twakReceipt?: string;
  x402Receipt?: string;
  cmcRequestId?: string;
  bitgetRequestId?: string;
  paperFillSource?: string;
  marketDataTimestamp?: string;
  registrationTxHash?: string;
}

export interface MandateAudit {
  jsonlPath: string;
  previousHash?: string;
  eventHash: string;
  replayable: boolean;
}

export interface SignalMandate {
  id: string;
  venue: Venue;
  mode: MandateMode;
  executionType: ExecutionType;
  createdAt: string;

  strategyId: string;
  naturalLanguageIntent: string;
  compiledStrategy: Record<string, unknown>;

  asset: string;
  assetContract?: string; // verified BEP-20 contract for BSC trades
  assetType: AssetType;
  action: MandateAction;

  perception: MandatePerception;
  decision: MandateDecision;
  economics: MandateEconomics;
  risk: MandateRisk;
  execution: MandateExecution;
  watchdog: MandateWatchdog;
  result?: MandateResult;
  proofAnchors: MandateProofAnchors;
  audit: MandateAudit;
}
