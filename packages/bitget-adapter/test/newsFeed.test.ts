import { describe, it, expect } from "vitest";
import { DisabledProvider, type LlmProvider } from "@wardenclaw/core";
import {
  YahooFinanceNewsFeed,
  CachedNewsScanner,
  parseRssItems,
  decodeEntities,
  sentimentToEvent,
  buildClassifierUser,
  NewsFeedError,
} from "../src/index.js";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Yahoo! Finance: NVDA News</title>
<item>
  <title>Nvidia beats Q1 earnings estimates &amp; raises guidance</title>
  <link>https://finance.yahoo.com/news/nvda-beats.html</link>
  <guid isPermaLink="false">nvda-beats-1</guid>
  <pubDate>${new Date(Date.now() - 3_600_000).toUTCString()}</pubDate>
</item>
<item>
  <title><![CDATA[Analysts split on Nvidia's data-center outlook]]></title>
  <link>https://finance.yahoo.com/news/nvda-split.html</link>
  <guid isPermaLink="false">nvda-split-2</guid>
  <pubDate>${new Date(Date.now() - 50 * 3_600_000).toUTCString()}</pubDate>
</item>
</channel></rss>`;

function stubTextFetch(body: string, ok = true, status = 200) {
  return async () => ({ ok, status, text: async () => body });
}

describe("parseRssItems", () => {
  it("parses plain and CDATA items with entities decoded", () => {
    const items = parseRssItems(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toContain("beats Q1 earnings estimates & raises");
    expect(items[1]!.title).toContain("Analysts split");
    expect(items[0]!.link).toBe("https://finance.yahoo.com/news/nvda-beats.html");
  });

  it("decodes numeric and named entities", () => {
    expect(decodeEntities("A &amp; B &#39;C&#39; &lt;D&gt;")).toBe("A & B 'C' <D>");
  });
});

describe("YahooFinanceNewsFeed", () => {
  it("maps recent items to NewsItem and drops stale ones", async () => {
    const feed = new YahooFinanceNewsFeed({ fetchImpl: stubTextFetch(RSS), maxAgeHours: 24 });
    const news = await feed.fetchNews("NVDA", "NVDAx");
    expect(news).toHaveLength(1); // the 50h-old item is dropped
    expect(news[0]!.asset).toBe("NVDAx");
    expect(news[0]!.source).toBe("yahoo_finance_rss");
    expect(news[0]!.headline).toContain("beats Q1");
  });

  it("fails loudly on HTTP errors — never an invented empty success", async () => {
    const feed = new YahooFinanceNewsFeed({ fetchImpl: stubTextFetch("", false, 503) });
    await expect(feed.fetchNews("NVDA", "NVDAx")).rejects.toThrow(NewsFeedError);
  });

  it("returns an honest empty array for a feed with no items", async () => {
    const feed = new YahooFinanceNewsFeed({
      fetchImpl: stubTextFetch(`<rss><channel><title>empty</title></channel></rss>`),
    });
    expect(await feed.fetchNews("NVDA", "NVDAx")).toEqual([]);
  });
});

describe("sentimentToEvent / buildClassifierUser", () => {
  it("maps the validated schema onto the reactor's ClassifiedEvent", () => {
    const ev = sentimentToEvent({
      asset: "NVDAx",
      eventType: "earnings",
      direction: "positive",
      confidence: 0.85,
      summary: "Beat and raise.",
      tradeRelevance: "high",
      riskFlags: [],
      sourceRefs: ["nvda-beats-1"],
    });
    expect(ev).toEqual({
      direction: "positive",
      confidence: 0.85,
      tradeRelevance: "high",
      riskFlags: [],
    });
  });

  it("grounds the user prompt in the real headlines only", () => {
    const user = buildClassifierUser("NVDAx", [
      {
        id: "x",
        asset: "NVDAx",
        headline: "Nvidia beats",
        url: "https://e.x/1",
        source: "yahoo_finance_rss",
        publishedAt: "2026-06-11T00:00:00.000Z",
      },
    ]);
    expect(user).toContain("Nvidia beats");
    expect(user).toContain("https://e.x/1");
  });
});

describe("CachedNewsScanner", () => {
  it("returns items without an event when the LLM is disabled (honest absence)", async () => {
    const feed = new YahooFinanceNewsFeed({ fetchImpl: stubTextFetch(RSS) });
    const scanner = new CachedNewsScanner(feed, new DisabledProvider());
    const r = await scanner.scan("NVDA", "NVDAx");
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.event).toBeUndefined();
    expect(scanner.classifierEnabled).toBe(false);
  });

  it("classifies via the provider and caches inside the TTL", async () => {
    let llmCalls = 0;
    const llm: LlmProvider = {
      name: "openai",
      async generateStructured() {
        llmCalls += 1;
        return {
          asset: "NVDAx",
          eventType: "earnings",
          direction: "positive",
          confidence: 0.9,
          summary: "Beat.",
          tradeRelevance: "high",
          riskFlags: [],
          sourceRefs: ["nvda-beats-1"],
        } as never;
      },
    };
    let fetches = 0;
    const feed = new YahooFinanceNewsFeed({
      fetchImpl: async () => {
        fetches += 1;
        return { ok: true, status: 200, text: async () => RSS };
      },
    });
    const scanner = new CachedNewsScanner(feed, llm, { ttlSeconds: 300 });
    const a = await scanner.scan("NVDA", "NVDAx");
    const b = await scanner.scan("NVDA", "NVDAx");
    expect(a.event?.direction).toBe("positive");
    expect(b).toBe(a); // cache hit
    expect(fetches).toBe(1);
    expect(llmCalls).toBe(1);
  });

  it("surfaces classifier failures via lastError and keeps the items", async () => {
    const llm: LlmProvider = {
      name: "openai",
      async generateStructured() {
        throw new Error("gateway 500");
      },
    };
    const feed = new YahooFinanceNewsFeed({ fetchImpl: stubTextFetch(RSS) });
    const scanner = new CachedNewsScanner(feed, llm);
    const r = await scanner.scan("NVDA", "NVDAx");
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.event).toBeUndefined();
    expect(scanner.lastError).toContain("gateway 500");
  });
});
