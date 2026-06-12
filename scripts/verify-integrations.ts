/**
 * Report the readiness of every external integration the xStock reactor uses.
 * Honest about what is wired vs. unverified: it checks for configuration, not
 * for fabricated success.
 *
 *   pnpm verify:integrations
 */

import "dotenv/config";

interface Integration {
  name: string;
  configured: boolean;
  note: string;
}

const integrations: Integration[] = [
  {
    name: "Bitget public market data (paper)",
    configured: true,
    note: "public REST; xStock symbols NEEDS-VERIFICATION (fail loud, never faked)",
  },
  {
    name: "Bitget Agent Hub MCP (perception)",
    configured: process.env.BITGET_AGENT_HUB_MCP === "true" || Boolean(process.env.BITGET_AGENT_HUB_BASE_URL),
    note: "official bitget-mcp-server over stdio; set BITGET_AGENT_HUB_MCP=true. Verify with pnpm verify:bitget-hub",
  },
  {
    name: "Bitget API credentials (optional, demo-key check)",
    configured: Boolean(process.env.BITGET_API_KEY && process.env.BITGET_API_SECRET && process.env.BITGET_API_PASSPHRASE),
    note: "only needed to re-test Demo Trading; spot xStocks run on internal_paper_engine",
  },
  {
    name: "Per-equity news feed (Yahoo Finance RSS)",
    configured: process.env.BITGET_NEWS_FEED !== "false",
    note: "real headlines per underlying; classified by NEWS_SENTIMENT_MODEL when an LLM key is set",
  },
  {
    name: "LLM provider (optional)",
    configured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) && process.env.LLM_ENABLED !== "false",
    note: "LLM proposes only; deterministic gates decide. Disabled mode is supported.",
  },
];

console.log("\n  Integration readiness\n");
for (const i of integrations) {
  const mark = i.configured ? "✅" : "⬜";
  console.log(`  ${mark} ${i.name}\n        ${i.note}`);
}
console.log("\n  Report only — the reactor fails loud when an integration it actually needs is missing.\n");
