/**
 * Real per-equity news perception.
 *
 * Source: Yahoo Finance's public per-ticker RSS feed (no API key) — REAL
 * headlines for the underlying US equity of each xStock. The fetcher is
 * injectable for tests and fails loudly on HTTP/parse errors; an empty feed
 * yields an honest empty array, never an invented headline.
 *
 * Classification: the existing core LLM layer (newsSentimentSchema, strict
 * structured output) turns real headlines into a ClassifiedEvent for the
 * reactor's sentiment gate. When the LLM is disabled the event is simply
 * absent — the reactor degrades to its deterministic gates, exactly as it
 * does today. No LLM ever invents news; it only classifies text we fetched.
 */

import {
  newsSentimentSchema,
  LlmDisabledError,
  type LlmProvider,
  type NewsSentiment,
} from "@wardenclaw/core";
import type { NewsItem } from "./types.js";
import type { ClassifiedEvent } from "./reactor.js";
import type { FetchLike } from "./marketData.js";

// ── RSS fetching ──────────────────────────────────────────────────────────────

export interface NewsFeedSource {
  readonly mode: string;
  /** Fetch real news for an underlying ticker; [] when none, throws on errors. */
  fetchNews(underlying: string, asset: string): Promise<NewsItem[]>;
}

export class NewsFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsFeedError";
  }
}

interface TextFetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
  }>;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z#x0-9]+;/gi, (m) => ENTITIES[m] ?? m);
}

export interface RssItem {
  title: string;
  link?: string;
  guid?: string;
  pubDate?: string;
}

/** Minimal, dependency-free RSS <item> parser (title/link/guid/pubDate). */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item[\s>][\s\S]*?<\/item>|<item>[\s\S]*?<\/item>/gi;
  const field = (block: string, tag: string): string | undefined => {
    const m =
      block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i")) ??
      block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    const v = m?.[1]?.trim();
    return v ? decodeEntities(v) : undefined;
  };
  for (const m of xml.matchAll(itemRe)) {
    const block = m[0];
    const title = field(block, "title");
    if (!title) continue;
    items.push({
      title,
      link: field(block, "link"),
      guid: field(block, "guid"),
      pubDate: field(block, "pubDate"),
    });
  }
  return items;
}

export interface YahooFinanceNewsFeedOptions {
  /** Defaults to the public Yahoo Finance RSS host. */
  baseUrl?: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: TextFetchLike;
  /** Ignore items older than this many hours (default 24). */
  maxAgeHours?: number;
  /** Keep at most this many items per asset (default 8). */
  maxItems?: number;
}

export class YahooFinanceNewsFeed implements NewsFeedSource {
  readonly mode = "yahoo_finance_rss" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: TextFetchLike;
  private readonly maxAgeHours: number;
  private readonly maxItems: number;

  constructor(opts: YahooFinanceNewsFeedOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://feeds.finance.yahoo.com").replace(/\/$/, "");
    const f = opts.fetchImpl ?? (globalThis.fetch as unknown as TextFetchLike | undefined);
    if (!f) throw new NewsFeedError("No fetch implementation available (Node >=18 required).");
    this.fetchImpl = f;
    this.maxAgeHours = opts.maxAgeHours ?? 24;
    this.maxItems = opts.maxItems ?? 8;
  }

  async fetchNews(underlying: string, asset: string): Promise<NewsItem[]> {
    const url =
      `${this.baseUrl}/rss/2.0/headline?s=${encodeURIComponent(underlying)}` +
      `&region=US&lang=en-US`;
    let res: Awaited<ReturnType<TextFetchLike>>;
    try {
      res = await this.fetchImpl(url, { headers: { "user-agent": "wardenclaw/0.1" } });
    } catch (err) {
      throw new NewsFeedError(`news fetch failed for ${underlying}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new NewsFeedError(`news HTTP ${res.status} for ${underlying}`);
    const xml = await res.text();
    const cutoff = Date.now() - this.maxAgeHours * 3_600_000;
    return parseRssItems(xml)
      .filter((r) => {
        const t = r.pubDate ? Date.parse(r.pubDate) : NaN;
        return !Number.isFinite(t) || t >= cutoff;
      })
      .slice(0, this.maxItems)
      .map((r, i) => ({
        id: r.guid ?? r.link ?? `${underlying}-rss-${i}`,
        asset,
        headline: r.title,
        url: r.link,
        source: this.mode,
        publishedAt: r.pubDate && Number.isFinite(Date.parse(r.pubDate))
          ? new Date(Date.parse(r.pubDate)).toISOString()
          : new Date().toISOString(),
      }));
  }
}

// ── LLM classification ────────────────────────────────────────────────────────

/**
 * System prompt for the classifier — mirrors
 * packages/core/src/prompts/newsSentimentClassifier.system.md (inlined so the
 * adapter has no runtime dependency on prompt files being shipped).
 */
export const NEWS_CLASSIFIER_SYSTEM = `You are WARDENCLAW's News/Sentiment Classifier. You classify a single news or
sentiment item into a structured object. You never recommend a trade and you never
say "buy" or "sell" — you only classify the event.

Hard rules:
- Every claim must be grounded in the provided input. Do not invent prices,
  earnings releases, liquidity, or facts not present in the input.
- If sources conflict or the item is a rumor, lower the confidence and add the
  appropriate riskFlags.
- Include source references (URLs or ids) from the input in "sourceRefs".
- Output ONLY one JSON object, no prose and no code fences.

The JSON object must have exactly these fields:
- "asset": string
- "eventType": one of "earnings","guidance","analyst_change","macro","major_news","rumor","unknown"
- "direction": one of "positive","negative","neutral","mixed","unknown"
- "confidence": number between 0 and 1
- "summary": string
- "tradeRelevance": one of "high","medium","low"
- "riskFlags": string[] (e.g. "rumor","unverified","conflicting_sources")
- "sourceRefs": string[]`;

export function buildClassifierUser(asset: string, items: NewsItem[]): string {
  const lines = items
    .slice(0, 5)
    .map((n) => `- [${n.publishedAt}] ${n.headline} (${n.url ?? n.id})`)
    .join("\n");
  return (
    `Asset: ${asset}\n` +
    `Real headlines fetched from ${items[0]?.source ?? "news feed"} (most recent first):\n` +
    `${lines}\n\n` +
    `Classify the OVERALL current news picture for ${asset} from these real headlines.`
  );
}

/** Map a validated NewsSentiment into the reactor's ClassifiedEvent. */
export function sentimentToEvent(s: NewsSentiment): ClassifiedEvent {
  return {
    direction: s.direction,
    confidence: s.confidence,
    tradeRelevance: s.tradeRelevance,
    riskFlags: s.riskFlags,
  };
}

export interface ScannedNews {
  asset: string;
  items: NewsItem[];
  /** Present only when an enabled LLM classified real headlines. */
  event?: ClassifiedEvent;
  /** Classifier summary for display (never feeds the engine). */
  summary?: string;
  fetchedAt: string;
}

export interface CachedNewsScannerOptions {
  /** Re-fetch/classify no more often than this (default 300s). */
  ttlSeconds?: number;
}

/**
 * Per-asset news scanner with a TTL cache, shared by the paper runner and the
 * interactive console. Feed errors propagate to the caller ON FIRST FETCH and
 * are surfaced (not swallowed) on refresh failures via lastError.
 */
export class CachedNewsScanner {
  private readonly cache = new Map<string, ScannedNews>();
  private readonly ttlMs: number;
  lastError: string | null = null;

  constructor(
    private readonly feed: NewsFeedSource,
    private readonly llm: LlmProvider,
    opts: CachedNewsScannerOptions = {},
  ) {
    this.ttlMs = (opts.ttlSeconds ?? 300) * 1000;
  }

  get classifierEnabled(): boolean {
    return this.llm.name !== "disabled";
  }

  /** Scan news for one asset, using the cache inside the TTL. */
  async scan(underlying: string, asset: string, force = false): Promise<ScannedNews> {
    const hit = this.cache.get(asset);
    if (!force && hit && Date.now() - Date.parse(hit.fetchedAt) < this.ttlMs) return hit;

    const items = await this.feed.fetchNews(underlying, asset);
    const scanned: ScannedNews = { asset, items, fetchedAt: new Date().toISOString() };

    if (items.length > 0) {
      try {
        const s = await this.llm.generateStructured({
          system: NEWS_CLASSIFIER_SYSTEM,
          user: buildClassifierUser(asset, items),
          schema: newsSentimentSchema,
        });
        scanned.event = sentimentToEvent(s);
        scanned.summary = s.summary;
        this.lastError = null;
      } catch (err) {
        if (!(err instanceof LlmDisabledError)) {
          // Real classifier failure: surface it; the reactor runs without an
          // event (deterministic gates only) rather than with a fabricated one.
          this.lastError = (err as Error).message;
        }
      }
    }

    this.cache.set(asset, scanned);
    return scanned;
  }
}
