/**
 * The Bitget reactor agent stack.
 *
 * One cycle wires the named agents from §4.4 together over real perception:
 *   BitgetMarketAgent → (StockNews/Sentiment/Macro/TechnicalSignal) →
 *   EventShockRanker → RiskMandateAgent → PaperExecutionAgent → WatchdogAgent →
 *   AuditReplayAgent.
 *
 * It is pure with respect to I/O: perception is passed in (the script wires the
 * real market-data client and any real news source), so the whole pipeline is
 * deterministic and testable. Every stage writes a hash-chained audit event and
 * the result is a validated SignalMandate.
 */

import {
  AuditLogger,
  computeFriction,
  evaluateNetEdge,
  parseMandate,
  type SignalMandate,
  type MandateMode,
} from "@runeclaw/core";
import type { BitgetCandle, BitgetExecutionMode } from "./types.js";
import {
  evaluateReactor,
  type ClassifiedEvent,
  type ReactorConfig,
  type ReactorDecision,
  type ShockDetection,
  DEFAULT_REACTOR_CONFIG,
} from "./reactor.js";
import { rankShocks, type ShockCandidate } from "./eventShockRanker.js";
import { evaluatePaperRiskGate } from "./riskGate.js";
import { PaperBook } from "./paperEngine.js";
import { atrPct, technicalDirection } from "./indicators.js";

/** Per-asset real perception for a cycle. */
export interface AssetPerception {
  asset: string;
  /** Real ascending candle series. */
  bars: BitgetCandle[];
  /** Bars since the armed shock, or null. Tracked across cycles by the caller. */
  barsSinceShock: number | null;
  /** The armed shock captured at spike time; carried forward for confirmation. */
  armedShock?: ShockDetection;
  /** Latest mid price (from the real ticker). */
  midPrice: number;
  /** ISO timestamp of the market data, used as a freshness anchor. */
  marketDataTimestamp: string;
  /** Optional classified event from REAL news (LLM over real article text). */
  event?: ClassifiedEvent;
  /** QQQ/SPY support 0..1 (from real index-proxy data). */
  indexSupport: number;
  /** Whether the feed is stale. */
  feedStale: boolean;
}

export interface BitgetAgentConfig {
  reactor: ReactorConfig;
  /** Paper execution mode label surfaced everywhere. */
  executionMode: BitgetExecutionMode;
  mode: MandateMode;
  /** Modeled slippage for paper fills, in bps. */
  paperSlippageBps: number;
  /** Volatility-stop sizing. */
  perTradeRiskPct: number;
  stopAtrMultiple: number;
  /** Informational friction quality filter (net-edge margin), in bps. */
  netEdgeMinBps: number;
  /** Strategy identity carried into each mandate. */
  strategyId: string;
  naturalLanguageIntent: string;
  compiledStrategy: Record<string, unknown>;
}

export const DEFAULT_BITGET_AGENT_CONFIG: Omit<
  BitgetAgentConfig,
  "compiledStrategy"
> = {
  reactor: DEFAULT_REACTOR_CONFIG,
  executionMode: "internal_paper_engine",
  mode: "paper",
  paperSlippageBps: 8,
  perTradeRiskPct: 3,
  stopAtrMultiple: 1.5,
  netEdgeMinBps: 15,
  strategyId: "bitget-earnings-news-reactor",
  naturalLanguageIntent:
    "Watch AAPLx/NVDAx/TSLAx/MSFTx/QQQx/SPYx. React only to earnings or major news " +
    "shocks. Never enter the first volatility spike. Risk 3% per trade with volatility " +
    "stops. Exit if sentiment reverses.",
};

export interface CycleResult {
  /** Mandates for every evaluated asset (entries and skips both audited). */
  mandates: SignalMandate[];
  /** The asset chosen for a paper entry this cycle, if any. */
  executedAsset: string | null;
}

let mandateSeq = 0;

function mandateId(asset: string, ts: string): string {
  mandateSeq += 1;
  return `bitget-${asset}-${ts.replace(/[^0-9]/g, "").slice(0, 14)}-${mandateSeq}`;
}

/**
 * Volatility-derived sizing for the paper book (mirrors §0.8a): position size
 * comes from the stop, capped by single-stock exposure and available cash.
 */
function sizePaperPosition(args: {
  equityUsd: number;
  cashUsd: number;
  midPrice: number;
  atr: number;
  perTradeRiskPct: number;
  stopAtrMultiple: number;
  maxSingleStockPct: number;
}): { notionalUsd: number; stopDistancePct: number; stopPrice: number } {
  const stopDistancePct = Math.max(args.stopAtrMultiple * args.atr, 0.005);
  const riskUsd = (args.perTradeRiskPct / 100) * args.equityUsd;
  let notionalUsd = riskUsd / stopDistancePct;
  notionalUsd = Math.min(
    notionalUsd,
    args.maxSingleStockPct * args.equityUsd,
    args.cashUsd,
  );
  const stopPrice = args.midPrice * (1 - stopDistancePct);
  return { notionalUsd, stopDistancePct, stopPrice };
}

export class BitgetReactorAgent {
  constructor(
    private readonly cfg: BitgetAgentConfig,
    private readonly book: PaperBook,
    private readonly audit: AuditLogger,
    private readonly auditPath: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Evaluate every asset, rank the confirmed entries, execute the top one. */
  async runCycle(perceptions: AssetPerception[]): Promise<CycleResult> {
    const prices: Record<string, number> = {};
    for (const p of perceptions) prices[p.asset] = p.midPrice;
    const equityUsd = this.book.equity(prices);

    const evaluations: Array<{ perception: AssetPerception; decision: ReactorDecision }> = [];
    for (const perception of perceptions) {
      const tech = technicalDirection(perception.bars);
      const pos = this.book.getPosition(perception.asset);
      const currentExposurePct = pos ? (pos.quantity * perception.midPrice) / Math.max(equityUsd, 1e-9) : 0;
      const decision = evaluateReactor({
        bars: perception.bars,
        barsSinceShock: perception.barsSinceShock,
        armedShock: perception.armedShock,
        event: perception.event,
        technicalDirection: tech,
        indexSupport: perception.indexSupport,
        currentExposurePct,
        feedStale: perception.feedStale,
        cfg: this.cfg.reactor,
      });
      evaluations.push({ perception, decision });
    }

    // Rank confirmed entries.
    const candidates: ShockCandidate[] = evaluations.map((e) => ({
      asset: e.perception.asset,
      decision: e.decision,
    }));
    const ranked = rankShocks(candidates);
    const winner = ranked[0]?.asset ?? null;

    const mandates: SignalMandate[] = [];
    let executedAsset: string | null = null;

    for (const { perception, decision } of evaluations) {
      const isWinner = perception.asset === winner && decision.action === "enter_long";
      const mandate = await this.buildAndAudit(perception, decision, isWinner, equityUsd);
      mandates.push(mandate);
      if (mandate.execution.status === "filled") executedAsset = perception.asset;
    }

    return { mandates, executedAsset };
  }

  private async buildAndAudit(
    perception: AssetPerception,
    decision: ReactorDecision,
    isWinner: boolean,
    equityUsd: number,
  ): Promise<SignalMandate> {
    const ts = this.now();
    const id = mandateId(perception.asset, ts);
    const paperFillSource = `internal_paper_engine@${perception.marketDataTimestamp}`;

    // Stage: perception.
    await this.audit.append({
      timestamp: ts,
      mandateId: id,
      stage: "perception",
      input: { asset: perception.asset, midPrice: perception.midPrice },
      output: {
        bars: perception.bars.length,
        indexSupport: perception.indexSupport,
        hasEvent: Boolean(perception.event),
      },
      proofAnchors: { marketDataTimestamp: perception.marketDataTimestamp },
    });

    // Stage: decision.
    await this.audit.append({
      timestamp: ts,
      mandateId: id,
      stage: "decision",
      input: { barsSinceShock: perception.barsSinceShock },
      output: {
        action: decision.action,
        score: decision.score ?? null,
        reason: decision.reason,
        ...(decision.rejectCode ? { rejectCode: decision.rejectCode } : {}),
      },
    });

    // Economics: informational friction + net-edge quality filter.
    const atr = atrPct(perception.bars);
    const sizing = sizePaperPosition({
      equityUsd,
      cashUsd: this.book.cash,
      midPrice: perception.midPrice,
      atr,
      perTradeRiskPct: this.cfg.perTradeRiskPct,
      stopAtrMultiple: this.cfg.stopAtrMultiple,
      maxSingleStockPct: this.cfg.reactor.maxSingleStockPct,
    });
    const expectedMoveBps = decision.expectedMoveBps ?? 0;
    const friction = computeFriction({
      notionalUsd: Math.max(sizing.notionalUsd, 1),
      gasInUsd: 0,
      gasOutUsd: 0,
      expectedSlippageBps: this.cfg.paperSlippageBps,
      lpFeeBps: 0,
      scoringSimCostBps: 0,
    });
    const netEdge = evaluateNetEdge({
      expectedMoveBps,
      frictionBps: friction.frictionBps,
      netEdgeMinBps: this.cfg.netEdgeMinBps,
    });

    await this.audit.append({
      timestamp: ts,
      mandateId: id,
      stage: "economics",
      input: { notionalUsd: sizing.notionalUsd, expectedMoveBps },
      output: {
        frictionBps: friction.frictionBps,
        netEdgePassed: netEdge.passed,
        stopDistancePct: sizing.stopDistancePct,
      },
    });

    // Risk gate (paper).
    const risk = evaluatePaperRiskGate({
      decision,
      currentExposurePct: 0,
      maxSingleStockPct: this.cfg.reactor.maxSingleStockPct,
      indexSupport: perception.indexSupport,
      minIndexSupport: this.cfg.reactor.minIndexSupport,
      feedStale: perception.feedStale,
      paperFillSource,
    });

    const shouldExecute =
      isWinner && risk.approved && netEdge.passed && sizing.notionalUsd > 0;

    await this.audit.append({
      timestamp: ts,
      mandateId: id,
      stage: "risk",
      input: { isWinner },
      output: {
        approved: risk.approved,
        ...(risk.rejectCode ? { rejectCode: risk.rejectCode } : {}),
        reasons: risk.reasons,
        netEdgePassed: netEdge.passed,
      },
    });

    // Execution (paper).
    let status: SignalMandate["execution"]["status"] = "not_submitted";
    let paperFill: Record<string, unknown> | undefined;
    if (shouldExecute) {
      const fill = this.book.open({
        asset: perception.asset,
        refPrice: perception.midPrice,
        notionalUsd: sizing.notionalUsd,
        stopPrice: sizing.stopPrice,
        slippageBps: this.cfg.paperSlippageBps,
        timestamp: ts,
      });
      status = "filled";
      paperFill = { ...fill };
    } else if (decision.action !== "enter_long") {
      status = "rejected";
    }

    await this.audit.append({
      timestamp: ts,
      mandateId: id,
      stage: "execution",
      input: { shouldExecute },
      output: { status, executionMode: this.cfg.executionMode },
      proofAnchors: { paperFillSource },
    });

    const mandate: SignalMandate = {
      id,
      venue: "bitget",
      mode: this.cfg.mode,
      executionType: "paper",
      createdAt: ts,
      strategyId: this.cfg.strategyId,
      naturalLanguageIntent: this.cfg.naturalLanguageIntent,
      compiledStrategy: this.cfg.compiledStrategy,
      asset: perception.asset,
      assetType: "xstock",
      action: decision.action === "enter_long" ? "enter_long" : "watch",
      perception: {
        source: "bitget_public_market_data",
        marketData: { midPrice: perception.midPrice, bars: perception.bars.length },
        sentiment: perception.event ? { direction: perception.event.direction } : undefined,
        macro: { indexSupport: perception.indexSupport },
        marketDataTimestamp: perception.marketDataTimestamp,
      },
      decision: {
        signalFamily: "catalyst",
        tradeScore: decision.score ?? 0,
        regime: "event_shock",
        reason: decision.reason,
        rejectedReasons: decision.rejectCode ? [decision.rejectCode] : undefined,
      },
      economics: {
        frictionBps: friction.frictionBps,
        realFrictionBps: friction.realFrictionBps,
        simulatedCostBps: friction.simulatedCostBps,
        expectedMoveBps,
        netEdgePassed: netEdge.passed,
        stopDistancePct: sizing.stopDistancePct,
      },
      risk: {
        approved: shouldExecute,
        maxPositionPct: this.cfg.reactor.maxSingleStockPct * 100,
        perTradeRiskPct: this.cfg.perTradeRiskPct,
        maxSlippageBps: this.cfg.paperSlippageBps,
        riskClass: shouldExecute ? "balanced" : "blocked",
        survivalMode: false,
      },
      execution: {
        adapter: this.cfg.executionMode,
        ...(paperFill ? { paperFill } : {}),
        status,
      },
      watchdog: { armed: status === "filled", triggers: [], actionsTaken: [] },
      proofAnchors: {
        paperFillSource,
        marketDataTimestamp: perception.marketDataTimestamp,
        bitgetRequestId: undefined,
      },
      audit: {
        jsonlPath: this.auditPath,
        eventHash: this.audit.currentHash,
        replayable: true,
      },
    };

    return parseMandate(mandate);
  }
}
