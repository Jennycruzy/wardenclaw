/**
 * Report the readiness of every external integration. Honest about what is wired
 * vs. unverified: it checks for configuration, not for fabricated success. Exits
 * non-zero only when a REQUIRED integration for the requested mode is missing.
 *
 *   pnpm verify:integrations            # report only
 *   pnpm verify:integrations -- --live  # require live-trading integrations
 */

interface Integration {
  name: string;
  configured: boolean;
  requiredForLive: boolean;
  note: string;
}

const live = process.argv.includes("--live");

const integrations: Integration[] = [
  {
    name: "CMC Agent Hub (perception)",
    configured: Boolean(process.env.CMC_API_KEY),
    requiredForLive: true,
    note: process.env.CMC_API_KEY ? "CMC_API_KEY set" : "set CMC_API_KEY (real perception; never fabricated)",
  },
  {
    name: "CMC x402 (pay-per-request)",
    configured: Boolean(process.env.CMC_X402_ENDPOINT) && process.env.CMC_X402_ENABLED !== "false",
    requiredForLive: false,
    note: "x402 in the trade loop; configure CMC_X402_ENDPOINT + TWAK x402",
  },
  {
    name: "Trust Wallet Agent Kit (sole executor)",
    configured: Boolean(process.env.TWAK_CONFIG_PATH),
    requiredForLive: true,
    note: process.env.TWAK_CONFIG_PATH ? "TWAK_CONFIG_PATH set" : "set TWAK_CONFIG_PATH (local signing; self-custody)",
  },
  {
    name: "BSC RPC pool (failover)",
    configured: Boolean(process.env.BSC_RPC_URLS),
    requiredForLive: true,
    note: process.env.BSC_RPC_URLS ? "BSC_RPC_URLS set" : "set BSC_RPC_URLS (comma-separated, with failover)",
  },
  {
    name: "Eligible tokens file",
    configured: true,
    requiredForLive: false,
    note: "CMC-resolved data/eligible-tokens.json preferred; canonical starter set otherwise",
  },
  {
    name: "Alert webhook",
    configured: Boolean(process.env.ALERT_WEBHOOK_URL),
    requiredForLive: true,
    note: process.env.ALERT_WEBHOOK_URL ? "ALERT_WEBHOOK_URL set" : "set ALERT_WEBHOOK_URL (phone alerts)",
  },
  {
    name: "Kill-switch token",
    configured: Boolean(process.env.KILL_SWITCH_TOKEN),
    requiredForLive: true,
    note: process.env.KILL_SWITCH_TOKEN ? "KILL_SWITCH_TOKEN set" : "set KILL_SWITCH_TOKEN (authenticated stop)",
  },
  {
    name: "Bitget public market data (paper)",
    configured: true,
    requiredForLive: false,
    note: "public REST; xStock symbols NEEDS-VERIFICATION (fail loud, never faked)",
  },
  {
    name: "LLM provider (optional)",
    configured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) && process.env.LLM_ENABLED !== "false",
    requiredForLive: false,
    note: "LLM proposes only; deterministic gates decide. Disabled mode is supported.",
  },
];

console.log("\n  Integration readiness\n");
let missingRequired = 0;
for (const i of integrations) {
  const mark = i.configured ? "✅" : i.requiredForLive ? "❌" : "⬜";
  const req = i.requiredForLive ? " (required for live)" : "";
  console.log(`  ${mark} ${i.name}${req}\n        ${i.note}`);
  if (live && i.requiredForLive && !i.configured) missingRequired++;
}

if (live && missingRequired > 0) {
  console.error(`\n  ✗ ${missingRequired} required live integration(s) missing. Configure them before live mode.\n`);
  process.exit(1);
}
console.log(`\n  ${live ? "Live readiness check complete." : "Report only (pass --live to enforce live requirements)."}\n`);
