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
} from "@wardenclaw/core";
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
import { PaperBook, type PaperTrade } from "./paperEngine.js";
import { atrPct, technicalDirection } from "./indicators.js";
import type { DemoSpotExecutor, DemoOrderResult } from "./demoExecutor.js";

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
  /** Positions closed this cycle (stop, profit target, or max-hold time exit). */
  exits: PaperTrade[];
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

export interface BitgetAgentExecutionWiring {
  /** Real Demo Trading executor; required when executionMode is official_bitget_demo. */
  demoExecutor?: DemoSpotExecutor;
  /** Maps a display asset (e.g. "NVDAx") to its Bitget API symbol. */
  symbolFor?: (asset: string) => string;
}

export class BitgetReactorAgent {
  constructor(
    private readonly cfg: BitgetAgentConfig,
    private readonly book: PaperBook,
    private readonly audit: AuditLogger,
    private readonly auditPath: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly wiring: BitgetAgentExecutionWiring = {},
  ) {
    if (cfg.executionMode === "official_bitget_demo" && (!wiring.demoExecutor || !wiring.symbolFor)) {
      throw new Error(
        "executionMode=official_bitget_demo requires a DemoSpotExecutor and a symbol " +
          "resolver — refusing to run a demo-labeled agent that would paper-fill internally.",
      );
    }
  }

  /**
   * Enforce exits on open positions against current real prices: the recorded
   * volatility stop, the profit target, and the max-hold time exit. Every exit
   * is executed in the book (and on Bitget demo when wired) and audited.
   */
  private async enforceExits(perceptions: AssetPerception[]): Promise<PaperTrade[]> {
    const BAR_MS = 5 * 60_000;
    const takeProfitPct = this.cfg.reactor.takeProfitPct ?? DEFAULT_REACTOR_CONFIG.takeProfitPct!;
    const maxHoldBars = this.cfg.reactor.maxHoldBars ?? DEFAULT_REACTOR_CONFIG.maxHoldBars!;
    const exits: PaperTrade[] = [];
    for (const p of perceptions) {
      const pos = this.book.getPosition(p.asset);
      if (!pos || p.feedStale) continue;
      const heldBars = (Date.parse(p.marketDataTimestamp) - Date.parse(pos.openedAt)) / BAR_MS;
      let reason: PaperTrade["reason"] | null = null;
      let why = "";
      if (p.midPrice <= pos.stopPrice) {
        reason = "stop";
        why = `volatility stop hit (${p.midPrice} ≤ ${pos.stopPrice})`;
      } else if (p.midPrice >= pos.entryPrice * (1 + takeProfitPct)) {
        reason = "signal_exit";
        why = `profit target +${(takeProfitPct * 100).toFixed(1)}% reached`;
      } else if (heldBars >= maxHoldBars) {
        reason = "signal_exit";
        why = `max hold ${maxHoldBars} bars elapsed`;
      }
      if (!reason) continue;

      const ts = this.now();
      let demoOrder: DemoOrderResult | undefined;
      let executionError: string | undefined;
      if (this.cfg.executionMode === "official_bitget_demo" && this.wiring.demoExecutor && this.wiring.symbolFor) {
        try {
          demoOrder = await this.wiring.demoExecutor.marketSell({
            symbol: this.wiring.symbolFor(p.asset),
            baseQuantity: pos.quantity,
          });
        } catch (err) {
          executionError = (err as Error).message;
        }
      }
      const trade = this.book.close({
        asset: p.asset,
        refPrice: p.midPrice,
        slippageBps: this.cfg.paperSlippageBps,
        timestamp: ts,
        reason,
      });
      exits.push(trade);
      await this.audit.append({
        timestamp: ts,
        mandateId: pos.mandateId ?? `exit-${p.asset}-${ts}`,
        stage: "settlement",
        input: { asset: p.asset, midPrice: p.midPrice, heldBars: Math.floor(heldBars) },
        output: {
          reason,
          why,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          pnlUsd: Number(trade.pnlUsd.toFixed(2)),
          pnlPct: Number(trade.pnlPct.toFixed(2)),
          ...(demoOrder ? { demoOrderId: demoOrder.orderId } : {}),
          ...(executionError ? { demoSellError: executionError } : {}),
        },
        proofAnchors: { marketDataTimestamp: p.marketDataTimestamp },
      });
    }
    return exits;
  }

  /** Evaluate every asset, rank the confirmed entries, execute the top one. */
  async runCycle(perceptions: AssetPerception[]): Promise<CycleResult> {
    // Exits first: an open position must be managed before new entries compete.
    const exits = await this.enforceExits(perceptions);

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

    return { mandates, executedAsset, exits };
  }

  private async buildAndAudit(
    perception: AssetPerception,
    decision: ReactorDecision,
    isWinner: boolean,
    equityUsd: number,
  ): Promise<SignalMandate> {
    const ts = this.now();
    const id = mandateId(perception.asset, ts);
    const isDemo = this.cfg.executionMode === "official_bitget_demo";
    const paperFillSource = `${this.cfg.executionMode}@${perception.marketDataTimestamp}`;

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

    // Execution: official Bitget Demo Trading when wired, else internal paper.
    let status: SignalMandate["execution"]["status"] = "not_submitted";
    let paperFill: Record<string, unknown> | undefined;
    let demoOrder: DemoOrderResult | undefined;
    let executionError: string | undefined;
    if (shouldExecute) {
      if (isDemo) {
        try {
          demoOrder = await this.wiring.demoExecutor!.marketBuy({
            symbol: this.wiring.symbolFor!(perception.asset),
            quoteNotionalUsd: Number(sizing.notionalUsd.toFixed(2)),
            clientOid: id,
          });
          status = demoOrder.status;
          if (demoOrder.status === "filled") {
            // Mirror the REAL demo fill into the book so equity/exposure/watchdog
            // tracking stays consistent. The authoritative record is demoOrder.
            this.book.open({
              asset: perception.asset,
              refPrice: demoOrder.avgFillPrice ?? perception.midPrice,
              notionalUsd: demoOrder.filledQuoteUsd,
              stopPrice: sizing.stopPrice,
              slippageBps: 0,
              timestamp: ts,
              mandateId: id,
            });
          }
        } catch (err) {
          status = "failed";
          executionError = (err as Error).message;
        }
      } else {
        const fill = this.book.open({
          asset: perception.asset,
          refPrice: perception.midPrice,
          notionalUsd: sizing.notionalUsd,
          stopPrice: sizing.stopPrice,
          slippageBps: this.cfg.paperSlippageBps,
          timestamp: ts,
          mandateId: id,
        });
        status = "filled";
        paperFill = { ...fill };
      }
    } else if (decision.action !== "enter_long") {
      status = "rejected";
    }

    await this.audit.append({
      timestamp: ts,
      mandateId: id,
      stage: "execution",
      input: { shouldExecute },
      output: {
        status,
        executionMode: this.cfg.executionMode,
        ...(executionError ? { error: executionError } : {}),
      },
      proofAnchors: isDemo
        ? { bitgetRequestId: demoOrder?.orderId }
        : { paperFillSource },
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
        ...(demoOrder ? { finalOrder: { ...demoOrder } } : {}),
        status,
      },
      watchdog: { armed: status === "filled", triggers: [], actionsTaken: [] },
      proofAnchors: {
        ...(isDemo ? {} : { paperFillSource }),
        marketDataTimestamp: perception.marketDataTimestamp,
        bitgetRequestId: demoOrder?.orderId,
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
