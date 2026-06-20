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

// ── Deterministic lexicon classifier (no LLM, fully reproducible) ───────────────
//
// When the LLM classifier is unavailable (disabled or quota-exhausted) the system
// must still run offline (a stated non-negotiable). This is a transparent,
// reproducible keyword classifier over the SAME real headlines the LLM would read:
// it counts directional signal words, and every output is a computed function of
// those counts — no narrated numbers, no fabricated facts. It is clearly labelled
// `deterministic` so it is never mistaken for the richer LLM read, and like the LLM
// it only CLASSIFIES fetched text; it never invents a headline or a price, and it
// never makes a risk decision (the deterministic permit gates do that).

const POSITIVE_WORDS = [
  "beat", "beats", "surge", "surges", "soar", "soars", "rally", "rallies", "jump", "jumps",
  "gain", "gains", "upgrade", "upgraded", "raise", "raises", "raised", "record", "strong",
  "outperform", "profit", "bullish", "tops", "growth", "expands", "win", "wins", "approval",
  "partnership", "buyback", "rebound", "boost", "boosts", "high", "higher", "upbeat",
];
const NEGATIVE_WORDS = [
  "miss", "misses", "missed", "plunge", "plunges", "plummet", "fall", "falls", "drop", "drops",
  "slump", "slumps", "downgrade", "downgraded", "cut", "cuts", "lawsuit", "probe", "investigation",
  "recall", "warning", "warns", "weak", "loss", "losses", "bearish", "decline", "declines",
  "layoff", "layoffs", "fraud", "halt", "halts", "slowdown", "sink", "sinks", "lower", "tumble",
];
const RUMOR_WORDS = ["rumor", "rumour", "reportedly", "speculation", "speculative", "unconfirmed", "sources say"];
const EARNINGS_WORDS = ["earnings", "quarterly", "results", "revenue", "eps", "guidance", "forecast", "outlook"];

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const countHits = (text: string, words: string[]): number =>
  words.reduce((acc, w) => (text.includes(w) ? acc + 1 : acc), 0);

/**
 * Classify a set of real headlines into a NewsSentiment using a deterministic
 * lexicon. Same shape as the LLM classifier so it is a drop-in fallback.
 */
export function classifyNewsDeterministic(asset: string, items: NewsItem[]): NewsSentiment {
  const corpus = items.map((n) => ` ${n.headline} ${n.body ?? ""} `.toLowerCase()).join(" ");
  const pos = countHits(corpus, POSITIVE_WORDS);
  const neg = countHits(corpus, NEGATIVE_WORDS);
  const total = pos + neg;
  const net = pos - neg;
  const rumor = countHits(corpus, RUMOR_WORDS) > 0;
  const earnings = countHits(corpus, EARNINGS_WORDS) > 0;

  let direction: NewsSentiment["direction"];
  if (total === 0) direction = "neutral";
  else if (pos > 0 && neg > 0 && Math.abs(net) <= 1) direction = "mixed";
  else if (net > 0) direction = "positive";
  else if (net < 0) direction = "negative";
  else direction = "mixed";

  // Confidence is a computed function of signal strength, deliberately capped well
  // below the LLM's range so a heuristic read never overstates its certainty.
  const strength = total === 0 ? 0 : Math.abs(net) / total;
  const confidence =
    total === 0 ? 0.2 : direction === "mixed" ? 0.4 : clamp(0.35 + 0.45 * strength, 0.35, 0.8);

  const eventType: NewsSentiment["eventType"] = earnings
    ? "earnings"
    : rumor
      ? "rumor"
      : total > 0
        ? "major_news"
        : "unknown";

  const tradeRelevance: NewsSentiment["tradeRelevance"] = total >= 3 ? "high" : total >= 1 ? "medium" : "low";

  const riskFlags = ["deterministic_lexicon"];
  if (rumor) riskFlags.push("rumor", "unverified");
  if (pos > 0 && neg > 0) riskFlags.push("conflicting_sources");

  return {
    asset,
    eventType,
    direction,
    confidence: Number(confidence.toFixed(2)),
    summary: `Deterministic lexicon over ${items.length} headline(s): ${pos} positive / ${neg} negative signal word(s).`,
    tradeRelevance,
    riskFlags,
    sourceRefs: items.slice(0, 5).map((n) => n.url ?? n.id),
  };
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
  /** Present when an enabled LLM or the deterministic fallback classified headlines. */
  event?: ClassifiedEvent;
  /** Classifier summary for display (never feeds the engine). */
  summary?: string;
  /** Which classifier produced `event` (absent when there is no event). */
  source?: "llm" | "deterministic";
  fetchedAt: string;
}

export interface CachedNewsScannerOptions {
  /** Re-fetch/classify no more often than this (default 300s). */
  ttlSeconds?: number;
  /**
   * When the LLM classifier is disabled or fails, classify the SAME real headlines
   * with the deterministic lexicon (so the system still runs offline) instead of
   * leaving the event absent. Default false — absence stays honest unless opted in.
   */
  deterministicFallback?: boolean;
}

/**
 * Per-asset news scanner with a TTL cache, shared by the paper runner and the
 * interactive console. Feed errors propagate to the caller ON FIRST FETCH and
 * are surfaced (not swallowed) on refresh failures via lastError.
 */
export class CachedNewsScanner {
  private readonly cache = new Map<string, ScannedNews>();
  private readonly ttlMs: number;
  private readonly deterministicFallback: boolean;
  lastError: string | null = null;

  constructor(
    private readonly feed: NewsFeedSource,
    private readonly llm: LlmProvider,
    opts: CachedNewsScannerOptions = {},
  ) {
    this.ttlMs = (opts.ttlSeconds ?? 300) * 1000;
    this.deterministicFallback = opts.deterministicFallback ?? false;
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
        scanned.source = "llm";
        this.lastError = null;
      } catch (err) {
        if (!(err instanceof LlmDisabledError)) {
          // Real classifier failure (e.g. quota exhausted): surface it.
          this.lastError = (err as Error).message;
        }
        // Fall back to the deterministic lexicon when opted in, so the perception
        // layer still classifies offline; otherwise leave the event honestly absent
        // and let the reactor run on its deterministic gates only.
        if (this.deterministicFallback) {
          const s = classifyNewsDeterministic(asset, items);
          scanned.event = sentimentToEvent(s);
          scanned.summary = s.summary;
          scanned.source = "deterministic";
        }
      }
    }

    this.cache.set(asset, scanned);
    return scanned;
  }
}
