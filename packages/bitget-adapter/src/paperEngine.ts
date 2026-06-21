/**
 * Internal paper execution engine.
 *
 * Real paper trading on REAL Bitget prices: fills are computed from the live
 * mid plus a modeled slippage, and every fill is labeled
 * `source: "internal_paper_engine"` with `simulated: true`. These are never
 * presented as real Bitget exchange fills — the dashboard shows the mode, and
 * the proof anchor records the paper-fill source.
 */

export interface PaperFill {
  asset: string;
  side: "buy" | "sell";
  /** Mid price used as the reference. */
  refPrice: number;
  /** Fill price after modeled slippage. */
  fillPrice: number;
  notionalUsd: number;
  quantity: number;
  slippageBps: number;
  timestamp: string;
  source: "internal_paper_engine";
  simulated: true;
}

export interface PaperPosition {
  asset: string;
  entryPrice: number;
  quantity: number;
  notionalUsd: number;
  stopPrice: number;
  openedAt: string;
  /** Mandate that opened this position; links exits back to their entry audit. */
  mandateId?: string;
}

export interface PaperTrade {
  asset: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notionalUsd: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt: string;
  closedAt: string;
  reason: "stop" | "signal_exit" | "watchdog" | "manual";
}

export interface PaperBookState {
  cashUsd: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  fills: PaperFill[];
}

/** Apply slippage against the trader: buys fill higher, sells fill lower. */
function applySlippage(refPrice: number, side: "buy" | "sell", slippageBps: number): number {
  const factor = slippageBps / 10_000;
  return side === "buy" ? refPrice * (1 + factor) : refPrice * (1 - factor);
}

export class PaperBook {
  private readonly positions = new Map<string, PaperPosition>();
  private cashUsd: number;
  private readonly trades: PaperTrade[] = [];
  private readonly fills: PaperFill[] = [];

  constructor(startingCashUsd: number, state?: PaperBookState) {
    this.cashUsd = state?.cashUsd ?? startingCashUsd;
    for (const position of state?.positions ?? []) {
      this.positions.set(position.asset, { ...position });
    }
    this.trades.push(...(state?.trades ?? []).map((trade) => ({ ...trade })));
    this.fills.push(...(state?.fills ?? []).map((fill) => ({ ...fill })));
  }

  get cash(): number {
    return this.cashUsd;
  }

  getPosition(asset: string): PaperPosition | undefined {
    return this.positions.get(asset);
  }

  openPositions(): PaperPosition[] {
    return [...this.positions.values()];
  }

  closedTrades(): PaperTrade[] {
    return [...this.trades];
  }

  allFills(): PaperFill[] {
    return [...this.fills];
  }

  snapshot(): PaperBookState {
    return {
      cashUsd: this.cashUsd,
      positions: this.openPositions().map((position) => ({ ...position })),
      trades: this.closedTrades().map((trade) => ({ ...trade })),
      fills: this.allFills().map((fill) => ({ ...fill })),
    };
  }

  /** Mark-to-market equity using a price map (asset → mid price). */
  equity(prices: Record<string, number>): number {
    let total = this.cashUsd;
    for (const pos of this.positions.values()) {
      const price = prices[pos.asset] ?? pos.entryPrice;
      total += pos.quantity * price;
    }
    return total;
  }

  /** Open a long paper position. Throws if one already exists for the asset. */
  open(args: {
    asset: string;
    refPrice: number;
    notionalUsd: number;
    stopPrice: number;
    slippageBps: number;
    timestamp: string;
    mandateId?: string;
  }): PaperFill {
    if (this.positions.has(args.asset)) {
      throw new Error(`paper position already open for ${args.asset}`);
    }
    if (args.notionalUsd > this.cashUsd + 1e-9) {
      throw new Error(`insufficient paper cash for ${args.asset}`);
    }
    const fillPrice = applySlippage(args.refPrice, "buy", args.slippageBps);
    const quantity = args.notionalUsd / fillPrice;
    this.cashUsd -= args.notionalUsd;
    this.positions.set(args.asset, {
      asset: args.asset,
      entryPrice: fillPrice,
      quantity,
      notionalUsd: args.notionalUsd,
      stopPrice: args.stopPrice,
      openedAt: args.timestamp,
      ...(args.mandateId ? { mandateId: args.mandateId } : {}),
    });
    const fill: PaperFill = {
      asset: args.asset,
      side: "buy",
      refPrice: args.refPrice,
      fillPrice,
      notionalUsd: args.notionalUsd,
      quantity,
      slippageBps: args.slippageBps,
      timestamp: args.timestamp,
      source: "internal_paper_engine",
      simulated: true,
    };
    this.fills.push(fill);
    return fill;
  }

  /** Close an open paper position at the given reference price. */
  close(args: {
    asset: string;
    refPrice: number;
    slippageBps: number;
    timestamp: string;
    reason: PaperTrade["reason"];
  }): PaperTrade {
    const pos = this.positions.get(args.asset);
    if (!pos) throw new Error(`no open paper position for ${args.asset}`);
    const fillPrice = applySlippage(args.refPrice, "sell", args.slippageBps);
    const proceeds = pos.quantity * fillPrice;
    this.cashUsd += proceeds;
    this.positions.delete(args.asset);

    const pnlUsd = proceeds - pos.notionalUsd;
    const trade: PaperTrade = {
      asset: args.asset,
      entryPrice: pos.entryPrice,
      exitPrice: fillPrice,
      quantity: pos.quantity,
      notionalUsd: pos.notionalUsd,
      pnlUsd,
      pnlPct: (pnlUsd / pos.notionalUsd) * 100,
      openedAt: pos.openedAt,
      closedAt: args.timestamp,
      reason: args.reason,
    };
    this.trades.push(trade);
    this.fills.push({
      asset: args.asset,
      side: "sell",
      refPrice: args.refPrice,
      fillPrice,
      notionalUsd: proceeds,
      quantity: pos.quantity,
      slippageBps: args.slippageBps,
      timestamp: args.timestamp,
      source: "internal_paper_engine",
      simulated: true,
    });
    return trade;
  }
}
