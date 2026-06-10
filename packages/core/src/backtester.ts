/**
 * Deterministic event-driven backtest / paper engine. It runs the SAME economics
 * the live agent runs — friction (real + simulated scoring cost), the net-edge
 * gate, and volatility-stop coherence — so a backtest reflects the actual scored
 * economics rather than an idealized fill. Used for Bitget paper validation and
 * for pre-window calibration.
 */

import { computeFriction } from "./frictionModel.js";
import { evaluateNetEdge } from "./netEdgeGate.js";
import { evaluateStopCoherence } from "./stopCoherence.js";

export interface Bar {
  time: string;
  price: number;
  /** Recent ATR as a fraction of price (e.g. 0.04 = 4%). */
  atrPct: number;
}

export interface BacktestSignal {
  score: number;
  expectedMoveBps: number;
  /** Optional explicit exit request for an open position. */
  exit?: boolean;
}

export type SignalFn = (bar: Bar, index: number, hasPosition: boolean) => BacktestSignal | null;

export interface BacktestConfig {
  startingCapitalUsd: number;
  perTradeRiskPct: number;
  stopAtrMultiple: number;
  maxPositionPct: number;
  netEdgeMinBps: number;
  frictionBudgetBps: number;
  scoringSimCostBps: number;
  gasPerLegUsd: number;
  slippageBps: number;
  lpFeeBps: number;
  safetyBufferBps: number;
}

export interface BacktestTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  notionalUsd: number;
  frictionBps: number;
  pnlUsd: number;
  reason: "stop" | "signal_exit" | "end_of_data";
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: Array<{ time: string; equityUsd: number }>;
  pnlUsd: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  numTrades: number;
  rejections: Record<string, number>;
}

interface OpenPosition {
  entryTime: string;
  entryPrice: number;
  notionalUsd: number;
  stopPrice: number;
  frictionBps: number;
}

export function runBacktest(bars: Bar[], signalFn: SignalFn, config: BacktestConfig): BacktestResult {
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ time: string; equityUsd: number }> = [];
  const rejections: Record<string, number> = {};

  let realizedEquity = config.startingCapitalUsd;
  let position: OpenPosition | null = null;

  const bump = (code: string) => {
    rejections[code] = (rejections[code] ?? 0) + 1;
  };

  const frictionBpsAt = (notionalUsd: number): number =>
    computeFriction({
      notionalUsd,
      gasInUsd: config.gasPerLegUsd,
      gasOutUsd: config.gasPerLegUsd,
      expectedSlippageBps: config.slippageBps,
      lpFeeBps: config.lpFeeBps,
      scoringSimCostBps: config.scoringSimCostBps,
      safetyBufferBps: config.safetyBufferBps,
    }).frictionBps;

  const closePosition = (bar: Bar, reason: BacktestTrade["reason"]) => {
    if (!position) return;
    const grossPct = (bar.price - position.entryPrice) / position.entryPrice;
    const frictionUsd = (position.frictionBps / 10_000) * position.notionalUsd;
    const pnlUsd = grossPct * position.notionalUsd - frictionUsd;
    realizedEquity += pnlUsd;
    trades.push({
      entryTime: position.entryTime,
      exitTime: bar.time,
      entryPrice: position.entryPrice,
      exitPrice: bar.price,
      notionalUsd: position.notionalUsd,
      frictionBps: position.frictionBps,
      pnlUsd,
      reason,
    });
    position = null;
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const signal = signalFn(bar, i, position !== null);

    if (position) {
      // Stop enforcement first (a forced safety exit).
      if (bar.price <= position.stopPrice) {
        closePosition(bar, "stop");
      } else if (signal?.exit) {
        closePosition(bar, "signal_exit");
      }
    } else if (signal && !signal.exit) {
      const portfolioUsd = realizedEquity;
      const deployableUsd = realizedEquity;
      const coherence = evaluateStopCoherence({
        portfolioUsd,
        deployableUsd,
        perTradeRiskPct: config.perTradeRiskPct,
        stopAtrMultiple: config.stopAtrMultiple,
        recentAtrPct: bar.atrPct,
        maxPositionPct: config.maxPositionPct,
        frictionBudgetBps: config.frictionBudgetBps,
        estimateFrictionBps: frictionBpsAt,
      });

      if (!coherence.passed) {
        bump(coherence.rejectCode ?? "REJECT_STOP_COHERENCE");
      } else {
        const frictionBps = frictionBpsAt(coherence.positionSizeUsd);
        const netEdge = evaluateNetEdge({
          expectedMoveBps: signal.expectedMoveBps,
          frictionBps,
          netEdgeMinBps: config.netEdgeMinBps,
        });
        if (!netEdge.passed) {
          bump(netEdge.rejectCode ?? "REJECT_NET_EDGE");
        } else {
          position = {
            entryTime: bar.time,
            entryPrice: bar.price,
            notionalUsd: coherence.positionSizeUsd,
            stopPrice: bar.price * (1 - coherence.stopDistancePct),
            frictionBps,
          };
        }
      }
    }

    const unrealized = position
      ? ((bar.price - position.entryPrice) / position.entryPrice) * position.notionalUsd
      : 0;
    equityCurve.push({ time: bar.time, equityUsd: realizedEquity + unrealized });
  }

  // Close any position left open at the end.
  if (position && bars.length > 0) {
    closePosition(bars[bars.length - 1]!, "end_of_data");
    const last = equityCurve[equityCurve.length - 1];
    if (last) last.equityUsd = realizedEquity;
  }

  const pnlUsd = realizedEquity - config.startingCapitalUsd;
  const totalReturnPct =
    config.startingCapitalUsd > 0 ? (pnlUsd / config.startingCapitalUsd) * 100 : 0;

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    if (point.equityUsd > peak) peak = point.equityUsd;
    if (peak > 0) {
      const dd = ((peak - point.equityUsd) / peak) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const winRate = trades.length ? wins / trades.length : 0;

  return {
    trades,
    equityCurve,
    pnlUsd,
    totalReturnPct,
    maxDrawdownPct,
    winRate,
    numTrades: trades.length,
    rejections,
  };
}
