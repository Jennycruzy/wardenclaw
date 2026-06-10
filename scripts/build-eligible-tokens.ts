/**
 * Resolves the enumerated eligible symbols to their exact BEP-20 contract
 * addresses via the CoinMarketCap API and writes data/eligible-tokens.json as an
 * address-keyed allowlist. Symbols that cannot be resolved to a BSC contract are
 * excluded and logged. Fails loudly without a CMC_API_KEY — it never fabricates
 * addresses.
 */

import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { ENUMERATED_ELIGIBLE_SYMBOLS, type EligibleToken } from "@wardenclaw/core";

const STABLE_SYMBOLS = new Set([
  "USDT", "USDC", "FDUSD", "DAI", "TUSD", "FRAX", "USD1", "USDe", "USDD",
  "lisUSD", "USDf", "USDF", "FRXUSD", "DUSD", "XUSD", "EURI",
]);

const CMC_BASE = process.env.CMC_API_URL ?? "https://pro-api.coinmarketcap.com";
const OUT_PATH = process.env.ELIGIBLE_TOKENS_PATH ?? "data/eligible-tokens.json";
const BSC_PLATFORM = "BNB Smart Chain (BEP20)";

interface CmcInfoEntry {
  id: number;
  symbol: string;
  platform?: { name?: string; token_address?: string } | null;
  contract_address?: Array<{ contract_address: string; platform?: { name?: string } }>;
}

function resolveBscContract(entry: CmcInfoEntry): { address: string } | null {
  // Prefer the explicit contract_address list (multi-chain tokens).
  for (const c of entry.contract_address ?? []) {
    if (c.platform?.name && /bnb|bsc|binance|bep20/i.test(c.platform.name) && c.contract_address) {
      return { address: c.contract_address };
    }
  }
  // Fall back to the primary platform if it is BSC.
  if (entry.platform?.name && /bnb|bsc|binance|bep20/i.test(entry.platform.name) && entry.platform.token_address) {
    return { address: entry.platform.token_address };
  }
  return null;
}

async function main(): Promise<void> {
  const apiKey = process.env.CMC_API_KEY;
  if (!apiKey) {
    console.error("✗ CMC_API_KEY is required to resolve eligible-token contracts. Set it in .env.");
    console.error("  This script will not fabricate contract addresses — eligibility must be real.");
    process.exit(1);
  }

  const symbols = [...new Set(ENUMERATED_ELIGIBLE_SYMBOLS)];
  const resolved: EligibleToken[] = [];
  const unresolved: string[] = [];

  // CMC /v2/cryptocurrency/info accepts comma-separated symbols (batch).
  const BATCH = 50;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const url = `${CMC_BASE}/v2/cryptocurrency/info?symbol=${encodeURIComponent(batch.join(","))}&aux=platform`;
    const res = await fetch(url, { headers: { "X-CMC_PRO_API_KEY": apiKey } });
    if (!res.ok) {
      console.error(`✗ CMC API error ${res.status}: ${await res.text().catch(() => "")}`);
      process.exit(1);
    }
    const json = (await res.json()) as { data?: Record<string, CmcInfoEntry | CmcInfoEntry[]> };
    for (const symbol of batch) {
      const raw = json.data?.[symbol] ?? json.data?.[symbol.toUpperCase()];
      const candidates = Array.isArray(raw) ? raw : raw ? [raw] : [];
      let picked: EligibleToken | null = null;
      for (const entry of candidates) {
        const contract = resolveBscContract(entry);
        if (contract) {
          picked = {
            symbol,
            cmcId: entry.id,
            bscContractAddress: contract.address,
            decimals: 18,
            isStable: STABLE_SYMBOLS.has(symbol) || undefined,
          };
          break;
        }
      }
      if (picked) resolved.push(picked);
      else unresolved.push(symbol);
    }
  }

  await writeFile(OUT_PATH, JSON.stringify(resolved, null, 2) + "\n", "utf8");
  console.log(`✓ Wrote ${resolved.length} resolved BEP-20 tokens to ${OUT_PATH}`);
  if (unresolved.length) {
    console.warn(`⚠ ${unresolved.length} symbols had no resolvable BSC contract (excluded): ${unresolved.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("✗ build-eligible-tokens failed:", err);
  process.exit(1);
});
