/**
 * Bitget Agent Hub perception adapter.
 *
 * Agent Hub surfaces (aggregated news, sentiment, macro, technical signals) are
 * NOT verified in this environment. Rather than fake them, this defines a clean
 * interface and a default implementation that fails loudly with a clear TODO.
 * The reactor degrades gracefully: with no Agent Hub source, it relies on real
 * price/volume shock detection and any user-supplied real news only.
 */

import type { NewsItem } from "./types.js";

export interface SentimentReading {
  asset: string;
  /** -1 (max bearish) .. +1 (max bullish). */
  score: number;
  source: string;
  timestamp: string;
}

export interface MacroReading {
  /** 0 (hostile) .. 1 (supportive) market backdrop. */
  support: number;
  source: string;
  timestamp: string;
}

export interface AgentHubSource {
  readonly available: boolean;
  /** Real, attributed news for an asset. */
  fetchNews(asset: string): Promise<NewsItem[]>;
  fetchSentiment(asset: string): Promise<SentimentReading>;
  fetchMacro(): Promise<MacroReading>;
}

const NOT_VERIFIED =
  "Bitget Agent Hub is not configured/verified. Set BITGET_AGENT_HUB_BASE_URL " +
  "and verify the official tool names, or supply a real news/sentiment source. " +
  "RUNECLAW will not fabricate news, sentiment, or macro data.";

/** The default, intentionally-unavailable Agent Hub. Every call fails loudly. */
export class UnverifiedAgentHub implements AgentHubSource {
  readonly available = false;
  async fetchNews(_asset: string): Promise<NewsItem[]> {
    throw new Error(NOT_VERIFIED);
  }
  async fetchSentiment(_asset: string): Promise<SentimentReading> {
    throw new Error(NOT_VERIFIED);
  }
  async fetchMacro(): Promise<MacroReading> {
    throw new Error(NOT_VERIFIED);
  }
}

/**
 * An Agent Hub backed by injected real readings (e.g. a verified Agent Hub HTTP
 * client, or a user-provided feed). Used when real perception is available. It
 * holds no fabricated data — callers populate it from real sources.
 */
export class InjectedAgentHub implements AgentHubSource {
  readonly available = true;
  constructor(
    private readonly readings: {
      news?: Record<string, NewsItem[]>;
      sentiment?: Record<string, SentimentReading>;
      macro?: MacroReading;
    },
  ) {}

  async fetchNews(asset: string): Promise<NewsItem[]> {
    return this.readings.news?.[asset] ?? [];
  }
  async fetchSentiment(asset: string): Promise<SentimentReading> {
    const s = this.readings.sentiment?.[asset];
    if (!s) throw new Error(`No sentiment reading provided for ${asset}`);
    return s;
  }
  async fetchMacro(): Promise<MacroReading> {
    if (!this.readings.macro) throw new Error("No macro reading provided");
    return this.readings.macro;
  }
}
