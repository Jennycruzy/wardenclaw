/**
 * Strict structured-output schemas for every LLM call. No freeform LLM text ever
 * feeds trading: each provider call is validated against one of these before use.
 */

import { z } from "zod";

export const riskLimitsSchema = z.object({
  maxPositionPct: z.number(),
  perTradeRiskPct: z.number(),
  maxConcurrentPositions: z.number(),
  maxDailyTrades: z.number(),
  stopAtrMultiple: z.number(),
  maxSlippageBps: z.number(),
  netEdgeMinBps: z.number(),
});

export const compiledStrategySchema = z.object({
  universe: z.array(z.string()),
  catalysts: z.array(z.string()).optional(),
  entryRules: z.array(z.string()),
  exitRules: z.array(z.string()),
  riskLimits: riskLimitsSchema,
  allowedActions: z.array(z.enum(["watch", "enter_long", "exit", "reduce", "hold", "pause"])),
  noTradeConditions: z.array(z.string()),
  validationMode: z.enum(["paper", "backtest", "live", "rehearsal"]),
});

export type CompiledStrategy = z.infer<typeof compiledStrategySchema>;

export const newsSentimentSchema = z.object({
  asset: z.string(),
  eventType: z.enum([
    "earnings",
    "guidance",
    "analyst_change",
    "macro",
    "major_news",
    "rumor",
    "unknown",
  ]),
  direction: z.enum(["positive", "negative", "neutral", "mixed", "unknown"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  tradeRelevance: z.enum(["high", "medium", "low"]),
  riskFlags: z.array(z.string()),
  sourceRefs: z.array(z.string()),
});

export type NewsSentiment = z.infer<typeof newsSentimentSchema>;

export const auditSummarySchema = z.object({
  mandateId: z.string(),
  plainEnglishSummary: z.string(),
  whyTradeHappened: z.array(z.string()),
  whyTradeWasSkipped: z.array(z.string()),
  riskActions: z.array(z.string()),
  executionProof: z.array(z.string()),
  pnlSummary: z.string(),
  judgeReplayNotes: z.array(z.string()),
});

export type AuditSummary = z.infer<typeof auditSummarySchema>;

export const postTradeReflectionSchema = z.object({
  mandateId: z.string(),
  whatWorked: z.array(z.string()),
  whatFailed: z.array(z.string()),
  rulesTriggered: z.array(z.string()),
  parametersToReview: z.array(z.string()),
});

export type PostTradeReflection = z.infer<typeof postTradeReflectionSchema>;
