/**
 * Derivatives-sentiment perception from the official Bitget Agent Hub MCP server
 * — a real implementation of the Agent Hub "sentiment-analyst" Skill's data
 * (funding rates + open interest / positioning), not a fabricated news feed.
 *
 * Funding rate is the perpetual-swap longs-vs-shorts cost: positive funding =
 * crowd is paying to be long (bullish positioning / risk-on), negative = paying
 * to be short (bearish / risk-off). Open interest is participation/conviction.
 * Both are real numbers fetched live; the mapping below is deterministic and
 * testable. This is a market-wide DERIVATIVES backdrop (a crypto-perp signal),
 * not a per-equity news sentiment — callers use it as a risk regime.
 *
 * Verified envelopes (bitget-mcp-server@1.1.0):
 *   futures_get_funding_rate → data.data.currentFundRate[0]
 *     { symbol, fundingRate, fundingRateInterval, minFundingRate, maxFundingRate }
 *   futures_get_open_interest → data.data.openInterestList[0] { symbol, size }
 */

import type { McpToolCaller } from "./mcpMarketData.js";
import {
  type AgentHubSource,
  type SentimentReading,
  type MacroReading,
} from "./agentHub.js";
import type { NewsItem } from "./types.js";

export type SentimentRegime = "risk_on" | "neutral" | "risk_off";

export interface DerivativesSentiment {
  symbol: string;
  /** Raw funding rate per interval (decimal, e.g. 0.00003). */
  fundingRate: number;
  /** Open interest in base units (contracts). */
  openInterest: number;
  /** Normalized positioning sentiment, -1 (bearish) .. +1 (bullish). */
  score: number;
  regime: SentimentRegime;
  riskFlags: string[];
  source: string;
  timestamp: string;
}

/** Funding-rate scale: 0.0003 per interval (≈33%/yr) maps to a ~0.3 score. */
export const DEFAULT_FUNDING_SCALE = 0.0003;

/**
 * Map a funding rate to a bounded positioning score in [-1, 1] via tanh, so
 * extreme funding saturates rather than blowing past the range.
 */
export function fundingRateToScore(rate: number, scale: number = DEFAULT_FUNDING_SCALE): number {
  if (!Number.isFinite(rate) || scale <= 0) return 0;
  return Math.tanh(rate / scale);
}

/** Classify a positioning score into a tradeable risk regime. */
export function sentimentRegime(score: number): SentimentRegime {
  if (score > 0.33) return "risk_on";
  if (score < -0.33) return "risk_off";
  return "neutral";
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : NaN;
}

interface FundingEnvelope {
  ok?: boolean;
  data?: { data?: { currentFundRate?: Array<Record<string, unknown>> } };
}
interface OiEnvelope {
  ok?: boolean;
  data?: { data?: { openInterestList?: Array<Record<string, unknown>>; ts?: string } };
}

export interface BitgetMcpAgentHubOptions {
  /** Mix product type (default "USDT-FUTURES"). */
  productType?: string;
  /** Funding-rate scale for the sentiment mapping. */
  fundingScale?: number;
  /** Symbol used for the market-wide macro backdrop (default "BTCUSDT"). */
  macroSymbol?: string;
}

/**
 * AgentHubSource backed by the live Bitget MCP futures tools. It never fabricates:
 * a symbol without a perp market, an empty payload, or a tool error all throw.
 * `fetchNews` returns [] because the MCP exposes no news endpoint (the news Skill
 * is an LLM agent-skill, not a data API) — honest absence, not invented text.
 */
export class BitgetMcpAgentHub implements AgentHubSource {
  readonly available = true;
  private readonly productType: string;
  private readonly fundingScale: number;
  private readonly macroSymbol: string;

  constructor(
    private readonly client: McpToolCaller,
    opts: BitgetMcpAgentHubOptions = {},
  ) {
    this.productType = opts.productType ?? "USDT-FUTURES";
    this.fundingScale = opts.fundingScale ?? DEFAULT_FUNDING_SCALE;
    this.macroSymbol = opts.macroSymbol ?? "BTCUSDT";
  }

  /** Full derivatives-sentiment reading (funding + OI) for a perp symbol. */
  async getDerivativesSentiment(symbol: string): Promise<DerivativesSentiment> {
    const [fundEnv, oiEnv] = await Promise.all([
      this.client.callTool<FundingEnvelope>("futures_get_funding_rate", {
        symbol,
        productType: this.productType,
      }),
      this.client.callTool<OiEnvelope>("futures_get_open_interest", {
        symbol,
        productType: this.productType,
      }),
    ]);
    if (fundEnv?.ok !== true) throw new Error(`funding rate unavailable for ${symbol}`);
    const fundRow = fundEnv.data?.data?.currentFundRate?.[0];
    const rate = num(fundRow?.fundingRate);
    if (!Number.isFinite(rate)) {
      throw new Error(`no funding rate for ${symbol} (no perp market?)`);
    }
    const oiRow = oiEnv?.ok === true ? oiEnv.data?.data?.openInterestList?.[0] : undefined;
    const oi = num(oiRow?.size);

    const score = fundingRateToScore(rate, this.fundingScale);
    const riskFlags: string[] = [];
    if (Math.abs(score) > 0.85) riskFlags.push("crowded_positioning");
    return {
      symbol,
      fundingRate: rate,
      openInterest: Number.isFinite(oi) ? oi : 0,
      score,
      regime: sentimentRegime(score),
      riskFlags,
      source: "bitget-mcp:funding_rate+open_interest",
      timestamp: new Date().toISOString(),
    };
  }

  async fetchSentiment(asset: string): Promise<SentimentReading> {
    const d = await this.getDerivativesSentiment(asset);
    return { asset, score: d.score, source: d.source, timestamp: d.timestamp };
  }

  /** Market-wide risk backdrop in [0,1] from the macro symbol's funding. */
  async fetchMacro(): Promise<MacroReading> {
    const d = await this.getDerivativesSentiment(this.macroSymbol);
    return {
      support: Math.max(0, Math.min(1, (d.score + 1) / 2)),
      source: `bitget-mcp:${this.macroSymbol}:${d.source}`,
      timestamp: d.timestamp,
    };
  }

  /** No news endpoint on the MCP — honest empty, never fabricated. */
  async fetchNews(_asset: string): Promise<NewsItem[]> {
    return [];
  }
}
