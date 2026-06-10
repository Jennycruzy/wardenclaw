import { describe, it, expect } from "vitest";
import { UnverifiedAgentHub, InjectedAgentHub } from "../src/index.js";

describe("Agent Hub perception", () => {
  it("the unverified hub fails loudly (never fabricates news/sentiment)", async () => {
    const hub = new UnverifiedAgentHub();
    expect(hub.available).toBe(false);
    await expect(hub.fetchNews("NVDAx")).rejects.toThrow(/not configured\/verified/);
    await expect(hub.fetchSentiment("NVDAx")).rejects.toThrow(/not configured\/verified/);
    await expect(hub.fetchMacro()).rejects.toThrow(/not configured\/verified/);
  });

  it("the injected hub only returns the real readings it was given", async () => {
    const hub = new InjectedAgentHub({
      news: {
        NVDAx: [
          {
            id: "n1",
            asset: "NVDAx",
            headline: "Earnings beat",
            source: "real-feed",
            publishedAt: "2026-06-01T00:00:00Z",
          },
        ],
      },
      sentiment: { NVDAx: { asset: "NVDAx", score: 0.6, source: "real-feed", timestamp: "t" } },
      macro: { support: 0.7, source: "real-feed", timestamp: "t" },
    });
    expect(hub.available).toBe(true);
    expect((await hub.fetchNews("NVDAx"))[0]!.headline).toBe("Earnings beat");
    expect((await hub.fetchSentiment("NVDAx")).score).toBe(0.6);
    expect((await hub.fetchMacro()).support).toBe(0.7);
    // An asset with no provided reading does not invent one.
    expect(await hub.fetchNews("AAPLx")).toEqual([]);
    await expect(hub.fetchSentiment("AAPLx")).rejects.toThrow(/No sentiment/);
  });
});
