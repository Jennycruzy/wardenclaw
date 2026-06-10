/**
 * Build a validated BSC SignalMandate from a pipeline result. The mandate is the
 * replayable record of what the agent saw, decided, and (would) execute — with
 * CMC tool attribution, the full economics block, and proof-anchor slots for the
 * TWAK receipt, x402 receipt, and BSC tx hash filled in at execution time.
 */

import { parseMandate, type MandateMode, type SignalMandate } from "@wardenclaw/core";
import type { PipelineResult } from "./pipeline.js";

export interface MandateBuildInput {
  result: PipelineResult;
  mode: MandateMode;
  strategyId: string;
  naturalLanguageIntent: string;
  compiledStrategy: Record<string, unknown>;
  assetContract: string;
  cmcToolsUsed: string[];
  marketDataTimestamp: string;
  calibrationVersion: string;
  createdAt: string;
  id: string;
  /** Optional proof anchors known at build time (e.g. x402 receipt). */
  x402Receipt?: string;
  cmcRequestId?: string;
}

export function buildBscMandate(input: MandateBuildInput): SignalMandate {
  const r = input.result;
  const action = r.approved ? "enter_long" : "watch";

  const mandate: SignalMandate = {
    id: input.id,
    venue: "bsc",
    mode: input.mode,
    executionType: "spot_only",
    createdAt: input.createdAt,
    strategyId: input.strategyId,
    naturalLanguageIntent: input.naturalLanguageIntent,
    compiledStrategy: input.compiledStrategy,
    asset: r.symbol,
    assetContract: input.assetContract,
    assetType: "bep20",
    action,
    perception: {
      source: "cmc_agent_hub",
      marketData: { score: r.score, mode: r.mode },
      cmcToolsUsed: input.cmcToolsUsed,
      marketDataTimestamp: input.marketDataTimestamp,
    },
    decision: {
      signalFamily: r.signalFamily,
      tradeScore: r.score,
      regime: r.mode,
      reason: r.reasons,
      rejectedReasons: r.rejectCode ? [r.rejectCode] : undefined,
    },
    economics: {
      frictionBps: r.economics.frictionBps,
      realFrictionBps: r.economics.realFrictionBps,
      simulatedCostBps: r.economics.simulatedCostBps,
      expectedMoveBps: r.economics.expectedMoveBps,
      netEdgePassed: r.economics.netEdgePassed,
      stopDistancePct: r.economics.stopDistancePct,
      stopCoherencePassed: r.economics.stopCoherencePassed,
      shadowFillDeviationBps: r.economics.shadowFillDeviationBps,
      calibrationVersion: input.calibrationVersion,
    },
    risk: {
      approved: r.approved,
      maxPositionPct: 0,
      perTradeRiskPct: undefined,
      maxSlippageBps: r.intent?.slippageBps,
      riskClass: r.approved ? (r.mode === "attack" ? "aggressive" : "balanced") : "blocked",
      survivalMode: false,
    },
    execution: {
      adapter: "twak",
      requestedOrder: r.intent ? { ...r.intent } : undefined,
      status: r.approved ? "not_submitted" : "rejected",
    },
    watchdog: { armed: r.approved, triggers: [], actionsTaken: [] },
    proofAnchors: {
      x402Receipt: input.x402Receipt,
      cmcRequestId: input.cmcRequestId,
      marketDataTimestamp: input.marketDataTimestamp,
    },
    audit: { jsonlPath: "", eventHash: "", replayable: true },
  };

  return parseMandate(mandate);
}
