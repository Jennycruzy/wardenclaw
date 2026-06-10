/**
 * Runtime validation for the SignalMandate primitive. The static type lives in
 * types.ts; this Zod schema enforces the same shape at runtime so nothing
 * malformed (including LLM-produced objects) is ever treated as a valid mandate.
 */

import { z } from "zod";
import type { SignalMandate } from "./types.js";

const perception = z.object({
  source: z.string(),
  marketData: z.record(z.unknown()),
  news: z.record(z.unknown()).optional(),
  sentiment: z.record(z.unknown()).optional(),
  macro: z.record(z.unknown()).optional(),
  technicals: z.record(z.unknown()).optional(),
  liquidity: z.record(z.unknown()).optional(),
  rawRefs: z.array(z.string()).optional(),
  cmcToolsUsed: z.array(z.string()).optional(),
  marketDataTimestamp: z.string().optional(),
});

const decision = z.object({
  signalFamily: z.enum(["momentum", "catalyst", "scout", "safety"]),
  tradeScore: z.number(),
  regime: z.string(),
  reason: z.array(z.string()),
  rejectedReasons: z.array(z.string()).optional(),
});

const economics = z.object({
  frictionBps: z.number(),
  realFrictionBps: z.number(),
  simulatedCostBps: z.number(),
  expectedMoveBps: z.number(),
  netEdgePassed: z.boolean(),
  stopDistancePct: z.number().optional(),
  stopCoherencePassed: z.boolean().optional(),
  shadowFillDeviationBps: z.number().optional(),
  calibrationVersion: z.string().optional(),
});

const risk = z.object({
  approved: z.boolean(),
  maxPositionPct: z.number(),
  perTradeRiskPct: z.number().optional(),
  stopLossPct: z.number().optional(),
  takeProfitPct: z.number().optional(),
  maxSlippageBps: z.number().optional(),
  riskClass: z.enum(["conservative", "balanced", "aggressive", "blocked"]),
  survivalMode: z.boolean(),
});

const execution = z.object({
  adapter: z.string(),
  requestedOrder: z.record(z.unknown()).optional(),
  finalOrder: z.record(z.unknown()).optional(),
  txHash: z.string().optional(),
  paperFill: z.record(z.unknown()).optional(),
  status: z.enum([
    "not_submitted",
    "submitted",
    "filled",
    "cancelled",
    "rejected",
    "failed",
  ]),
});

const watchdog = z.object({
  armed: z.boolean(),
  triggers: z.array(z.string()),
  actionsTaken: z.array(z.string()),
});

const result = z.object({
  pnlPct: z.number().optional(),
  pnlUsd: z.number().optional(),
  maxDrawdownPct: z.number().optional(),
  closedAt: z.string().optional(),
  outcome: z.enum(["open", "win", "loss", "breakeven", "skipped"]),
});

const proofAnchors = z.object({
  bscTxHash: z.string().optional(),
  twakReceipt: z.string().optional(),
  x402Receipt: z.string().optional(),
  cmcRequestId: z.string().optional(),
  bitgetRequestId: z.string().optional(),
  paperFillSource: z.string().optional(),
  marketDataTimestamp: z.string().optional(),
  registrationTxHash: z.string().optional(),
});

const audit = z.object({
  jsonlPath: z.string(),
  previousHash: z.string().optional(),
  eventHash: z.string(),
  replayable: z.boolean(),
});

export const signalMandateSchema = z.object({
  id: z.string(),
  venue: z.enum(["bitget", "bsc"]),
  mode: z.enum(["paper", "backtest", "live", "rehearsal"]),
  executionType: z.enum(["spot_only", "paper"]),
  createdAt: z.string(),
  strategyId: z.string(),
  naturalLanguageIntent: z.string(),
  compiledStrategy: z.record(z.unknown()),
  asset: z.string(),
  assetContract: z.string().optional(),
  assetType: z.enum(["xstock", "xperp", "bep20", "stable"]),
  action: z.enum(["watch", "enter_long", "exit", "reduce", "hold", "pause"]),
  perception,
  decision,
  economics,
  risk,
  execution,
  watchdog,
  result: result.optional(),
  proofAnchors,
  audit,
});

export type ValidatedMandate = z.infer<typeof signalMandateSchema>;

/** Parse-and-validate. Throws a ZodError on any structural mismatch. */
export function parseMandate(input: unknown): SignalMandate {
  return signalMandateSchema.parse(input) as SignalMandate;
}

/** Non-throwing validation for guarded paths (e.g. LLM output). */
export function safeParseMandate(input: unknown) {
  return signalMandateSchema.safeParse(input);
}
