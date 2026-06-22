/**
 * "Break the Warden" arena — server-only orchestration over the EXISTING firewall
 * engine. This module adds NO new trading or risk logic: it parses a plain-English
 * command into the same `TradeIntent` the LLM layer produces, assembles a
 * `MarketContext` from the live console feed + real cached candles via the engine's
 * own `buildMarketContext`, and then calls the deterministic engine functions
 * (`evaluateTradePermit`, `issuePermit`, `auditStrategy`, `ghostCompare`,
 * `validatePermitForExecution`, `verifyCard`) exactly as the MCP server does.
 *
 * Every verdict therefore comes from the same code path as the real reactor; the
 * arena only chooses the inputs and shows the output. Paper / simulation only.
 */

import "server-only";
import {
  auditStrategy,
  evaluateTradePermit,
  issuePermit,
  verdictIssuesPermit,
  validatePermitForExecution,
  verifyCard,
  ghostCompare,
  resolveSigningKey,
  usingDevSigningKey,
  PermitStore,
  type TradeIntent,
  type TradeDirection,
  type MarketContext,
  type TradePermitEvaluation,
  type WardenPermit,
  type SimOrder,
  type SimCandle,
} from "@wardenclaw/core";
import {
  buildMarketContext,
  findXStock,
  XSTOCK_UNIVERSE,
  type BitgetCandle,
  type XStockSymbol,
} from "@wardenclaw/bitget-adapter";
import { loadBitgetLive, loadFixtureCandles } from "@/lib/data";

const SIGNING_KEY = resolveSigningKey();
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---- NL → TradeIntent (parsing only; never a risk decision) -----------------

const DIRECTION_WORDS: Array<[RegExp, TradeDirection]> = [
  [/\b(short|sell|dump)\b/i, "short"],
  [/\b(close|exit|flatten)\b/i, "close"],
  [/\b(reduce|trim|cut)\b/i, "reduce"],
];

/** Common English aliases for the verified universe (parsing convenience only). */
const ASSET_ALIASES: Record<string, string> = {
  nvidia: "NVDAx",
  apple: "AAPLx",
  tesla: "TSLAx",
  microstrategy: "MSTRx",
  strategy: "MSTRx",
  coinbase: "COINx",
};

const STOPWORDS = new Set([
  "buy", "sell", "ape", "long", "short", "into", "at", "of", "with", "leverage",
  "lev", "the", "a", "an", "go", "now", "limit", "market", "order", "and", "to",
  "on", "x", "k", "m", "b", "for", "all", "in", "size", "lot", "usd", "dollars",
  "reduce", "trim", "cut", "close", "exit", "flatten", "dump", "position", "my",
]);

function resolveAsset(text: string): { asset: string; known: boolean } {
  const lower = text.toLowerCase();
  // Verified-universe names first: display ("nvdax"), then underlying ("nvda").
  for (const s of XSTOCK_UNIVERSE) {
    if (lower.includes(s.display.toLowerCase())) return { asset: s.display, known: s.kind === "xstock" };
  }
  for (const s of XSTOCK_UNIVERSE) {
    if (new RegExp(`\\b${s.underlying.toLowerCase()}\\b`).test(lower)) {
      return { asset: s.display, known: s.kind === "xstock" };
    }
  }
  for (const [alias, display] of Object.entries(ASSET_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(lower)) return { asset: display, known: true };
  }
  // Unknown ticker-like token → fail-closed at the known_asset gate (a real demo).
  const token = lower
    .replace(/\$?\d[\d,.]*\s*[kmb]?/g, " ")
    .split(/[^a-z]+/)
    .find((t) => t.length >= 2 && t.length <= 6 && !STOPWORDS.has(t));
  if (token) return { asset: token.toUpperCase(), known: false };
  return { asset: "NVDAx", known: true };
}

function parseLeverage(text: string): number {
  const m = text.match(/(\d+(?:\.\d+)?)\s*x\b/i);
  return m ? Math.max(1, Number(m[1])) : 1;
}

function parseNotional(text: string): number {
  const stripped = text.replace(/(\d+(?:\.\d+)?)\s*x\b/i, " "); // drop the leverage token
  const mult = (suf?: string): number =>
    suf?.toLowerCase() === "k" ? 1e3 : suf?.toLowerCase() === "m" ? 1e6 : suf?.toLowerCase() === "b" ? 1e9 : 1;
  const dollar = stripped.match(/\$\s*([\d][\d,]*(?:\.\d+)?)\s*([kmb])?/i);
  if (dollar) return round2(Number(dollar[1].replace(/,/g, "")) * mult(dollar[2]));
  const suffixed = stripped.match(/\b([\d][\d,]*(?:\.\d+)?)\s*([kmb])\b/i);
  if (suffixed) return round2(Number(suffixed[1].replace(/,/g, "")) * mult(suffixed[2]));
  const bare = stripped.match(/\b([\d][\d,]*(?:\.\d+)?)\b/);
  if (bare) return round2(Number(bare[1].replace(/,/g, "")));
  return 1000;
}

export function parseTradeCommand(command: string): { intent: TradeIntent; assetKnown: boolean } {
  const raw = command.trim();
  const { asset, known } = resolveAsset(raw);
  const direction = DIRECTION_WORDS.find(([re]) => re.test(raw))?.[1] ?? "long";
  return {
    assetKnown: known,
    intent: {
      asset,
      direction,
      notionalUsd: parseNotional(raw),
      leverage: parseLeverage(raw),
      orderType: /\blimit\b/i.test(raw) ? "limit" : "market",
      triggerSource: "human",
      rawCommand: raw,
    },
  };
}

// ---- Live MarketContext assembly (real feed + real candles) ------------------

interface LiveSymbolRow {
  symbol: string;
  price: number | null;
  news?: { event?: string | null } | null;
}

function liveRowFor(asset: string): LiveSymbolRow | null {
  const live = loadBitgetLive();
  const symbols = (live?.symbols as LiveSymbolRow[] | undefined) ?? [];
  return symbols.find((s) => s.symbol === asset) ?? null;
}

function asBitgetCandles(candles: SimCandle[]): BitgetCandle[] {
  return candles.map((c) => ({ ...c, volume: 0 }));
}

export interface ArenaContext {
  market: MarketContext;
  source: {
    asset: string;
    assetKnown: boolean;
    price: number;
    livePriceUsed: boolean;
    candleCount: number;
    volPctile: number;
    marketOpen: boolean;
    feedAgeSec: number;
    signingKeyIsDev: boolean;
    /** Where the price came from: the live console feed, real cached candles, or a fallback. */
    priceSource: "live_feed" | "cached_candles" | "fallback";
  };
}

function priceSourceOf(livePrice: number | null, lastClose: number | undefined): ArenaContext["source"]["priceSource"] {
  if (livePrice !== null) return "live_feed";
  if (lastClose !== undefined) return "cached_candles";
  return "fallback";
}

export function buildArenaContext(asset: string, assetKnown: boolean): ArenaContext {
  const symbol: XStockSymbol | undefined = findXStock(asset);
  const candles = loadFixtureCandles(asset);
  const row = liveRowFor(asset);
  const livePrice = typeof row?.price === "number" ? row.price : null;
  const lastClose = candles.at(-1)?.close;
  const price = livePrice ?? lastClose ?? 100;
  const nowMs = Date.now();

  if (!assetKnown || !symbol || candles.length < 2) {
    // Unknown / unsupported asset: hand-built context. The known_asset gate
    // blocks it regardless of the other fields — fail-closed, by design.
    const market: MarketContext = {
      nowIso: new Date(nowMs).toISOString(),
      knownAsset: assetKnown && Boolean(symbol),
      btcCorrelated: symbol?.btcCorrelated ?? false,
      price,
      spreadBps: 12,
      volPctile: 0.3,
      confirmationPresent: true,
      marketOpen: false,
      btcRealizedVolRising: false,
      feedAgeSec: 0,
      closeOnlyActive: false,
    };
    return {
      market,
      source: {
        asset, assetKnown: market.knownAsset, price, livePriceUsed: livePrice !== null,
        candleCount: candles.length, volPctile: market.volPctile, marketOpen: market.marketOpen,
        feedAgeSec: 0, signingKeyIsDev: usingDevSigningKey(),
        priceSource: priceSourceOf(livePrice, lastClose),
      },
    };
  }

  const market = buildMarketContext({
    symbol,
    ticker: {
      symbol: symbol.bitgetSymbol,
      lastPrice: price,
      high24h: price,
      low24h: price,
      baseVolume: 0,
      quoteVolume: 0,
      timestamp: new Date(nowMs).toISOString(),
    },
    candles: asBitgetCandles(candles),
    nowMs,
  });

  return {
    market,
    source: {
      asset, assetKnown: true, price, livePriceUsed: livePrice !== null,
      candleCount: candles.length, volPctile: market.volPctile, marketOpen: market.marketOpen,
      feedAgeSec: market.feedAgeSec, signingKeyIsDev: usingDevSigningKey(),
      priceSource: priceSourceOf(livePrice, lastClose),
    },
  };
}

// ---- Counterfactual finale (real candle path) -------------------------------

export interface ArenaFinale {
  entryPrice: number;
  candles: Array<{ time: string; close: number; high: number; low: number }>;
  original: SimOrder & { liquidationPrice: number; liquidated: boolean; maxDrawdownPct: number; finalPnlUsd: number };
  adjusted: SimOrder & { liquidationPrice: number; liquidated: boolean; maxDrawdownPct: number; finalPnlUsd: number };
  drawdownAvoidedUsd: number;
  liquidationAvoided: boolean;
}

function buildFinale(
  intent: TradeIntent,
  evaluation: TradePermitEvaluation,
  candles: SimCandle[],
): ArenaFinale | null {
  if (candles.length < 2) return null;
  const path = candles.slice(0, 120);
  const entryPrice = path[0]!.open;
  const side: "long" | "short" = intent.direction === "short" ? "short" : "long";
  const original: SimOrder = { side, notionalUsd: intent.notionalUsd, leverage: Math.max(1, intent.leverage), entryPrice };
  const adj = evaluation.approvedOrder;
  // What the Warden would actually permit: the rewritten order, or — when the
  // verdict authorizes no leveraged order (BLOCK/DELAY) — a spot (1x) baseline.
  const adjusted: SimOrder = adj
    ? { side, notionalUsd: adj.notionalUsd, leverage: Math.max(1, adj.leverage), entryPrice }
    : { side, notionalUsd: intent.notionalUsd, leverage: 1, entryPrice };
  const cmp = ghostCompare(original, adjusted, path);
  return {
    entryPrice,
    candles: path.map((c) => ({ time: c.time, close: c.close, high: c.high, low: c.low })),
    original: { ...original, liquidationPrice: cmp.original.liquidationPrice, liquidated: cmp.original.liquidated, maxDrawdownPct: cmp.original.maxDrawdownPct, finalPnlUsd: cmp.original.finalPnlUsd },
    adjusted: { ...adjusted, liquidationPrice: cmp.wardenAdjusted.liquidationPrice, liquidated: cmp.wardenAdjusted.liquidated, maxDrawdownPct: cmp.wardenAdjusted.maxDrawdownPct, finalPnlUsd: cmp.wardenAdjusted.finalPnlUsd },
    drawdownAvoidedUsd: cmp.drawdownAvoidedUsd,
    liquidationAvoided: cmp.liquidationAvoided,
  };
}

// ---- Public actions used by the route ---------------------------------------

export interface ArenaEvaluation {
  intent: TradeIntent;
  context: ArenaContext["source"];
  strategy: { verdict: string; mayEmitMandates: boolean; failedChecks: Array<{ check: string; detail: string }> };
  trade: {
    verdict: string;
    gates: TradePermitEvaluation["gates"];
    gatesFailed: string[];
    approvedOrder: NonNullable<TradePermitEvaluation["approvedOrder"]> | null;
    hedgeLeg: NonNullable<TradePermitEvaluation["hedgeLeg"]> | null;
    modificationReason: string[];
    recheckCondition?: string;
  };
  permit: WardenPermit | null;
  finale: ArenaFinale | null;
}

let seq = 0;

export function evaluateArena(command: string): ArenaEvaluation {
  const { intent, assetKnown } = parseTradeCommand(command);
  const { market, source } = buildArenaContext(intent.asset, assetKnown);

  // Checkpoint 1 — Playbook Shield over the same phrase (strategy view).
  const audit = auditStrategy({ strategy: command, signingKey: SIGNING_KEY });

  // Checkpoint 2 — the ten deterministic gates + six-way verdict.
  const evaluation = evaluateTradePermit(intent, market);
  let permit: WardenPermit | null = null;
  if (verdictIssuesPermit(evaluation.verdict)) {
    permit = issuePermit({
      evaluation, intent, priceAtIssue: market.price, nowIso: market.nowIso,
      seq: ++seq, signingKey: SIGNING_KEY,
    });
  }

  const finale = buildFinale(intent, evaluation, loadFixtureCandles(intent.asset));

  return {
    intent,
    context: source,
    strategy: {
      verdict: audit.verdict,
      mayEmitMandates: audit.mayEmitMandates,
      failedChecks: audit.failedChecks.map((c) => ({ check: c.check, detail: c.note })),
    },
    trade: {
      verdict: evaluation.verdict,
      gates: evaluation.gates,
      gatesFailed: evaluation.gatesFailed,
      approvedOrder: evaluation.approvedOrder ?? null,
      hedgeLeg: evaluation.hedgeLeg ?? null,
      modificationReason: evaluation.modificationReason,
      ...(evaluation.recheckCondition ? { recheckCondition: evaluation.recheckCondition } : {}),
    },
    permit,
    finale,
  };
}

export type ArenaAttack = "intact" | "strip" | "edit" | "expire" | "drift" | "replay";

export interface ArenaAttackResult {
  attack: ArenaAttack;
  validation: ReturnType<typeof validatePermitForExecution>;
  chain: { prev_card_hash: string; json_hash: string; signature: string };
  cardVerification: ReturnType<typeof verifyCard>;
  nowIso: string;
  currentPrice: number;
}

/**
 * Run one tamper attempt through the executor's INDEPENDENT verifier. Each attack
 * is self-contained over a fresh PermitStore so the buttons are order-independent;
 * "replay" pre-consumes the permit (simulating one prior execution) and tries again.
 */
export function attackPermit(input: { permit: WardenPermit; attack: ArenaAttack }): ArenaAttackResult {
  const permit = input.permit;
  const attack = input.attack;
  const store = new PermitStore();

  let working: WardenPermit = permit;
  let nowIso = permit.created_at;
  let currentPrice = permit.price_at_issue;

  switch (attack) {
    case "strip":
      working = { ...permit, signature: "" };
      break;
    case "edit": {
      const base = permit.approved_order ?? {
        asset: permit.asset, direction: permit.direction,
        notionalUsd: 1000, leverage: 1, orderType: "market" as const,
      };
      working = {
        ...permit,
        approved_order: { ...base, notionalUsd: round2(base.notionalUsd * 10), leverage: 50 },
      };
      break;
    }
    case "expire":
      nowIso = new Date(Date.parse(permit.expires_at) + 60_000).toISOString();
      break;
    case "drift":
      currentPrice = round2(permit.price_at_issue * 1.05);
      break;
    case "replay":
      store.consume(permit.permit_id); // pretend it was already executed once
      break;
    case "intact":
    default:
      break;
  }

  store.register(working);
  const validation = validatePermitForExecution({
    permit: working, store, currentPrice, nowIso,
    requestedAction: permit.direction, signingKey: SIGNING_KEY,
  });
  const cardVerification = verifyCard(working, { signingKey: SIGNING_KEY });

  return {
    attack,
    validation,
    chain: { prev_card_hash: working.prev_card_hash, json_hash: working.json_hash, signature: working.signature },
    cardVerification,
    nowIso,
    currentPrice,
  };
}
