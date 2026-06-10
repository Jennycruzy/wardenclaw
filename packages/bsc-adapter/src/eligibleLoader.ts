/**
 * Load the address-keyed eligible allowlist.
 *
 * Prefers the authoritative data/eligible-tokens.json built from CMC; when that
 * file is absent it falls back to the curated STARTER_TOKENS (real canonical
 * mainnet addresses) and reports `source: "starter_fallback"` so the caller can
 * surface it. It never invents addresses.
 */

import { existsSync, readFileSync } from "node:fs";
import { EligibleAllowlist, type EligibleToken } from "@runeclaw/core";
import { STARTER_TOKENS } from "./knownTokens.js";

export interface LoadedAllowlist {
  allowlist: EligibleAllowlist;
  tokens: EligibleToken[];
  source: "file" | "starter_fallback";
  path?: string;
}

export function loadEligibleTokens(path: string): LoadedAllowlist {
  if (existsSync(path)) {
    const tokens = JSON.parse(readFileSync(path, "utf8")) as EligibleToken[];
    if (Array.isArray(tokens) && tokens.length > 0) {
      return { allowlist: new EligibleAllowlist(tokens), tokens, source: "file", path };
    }
  }
  return {
    allowlist: new EligibleAllowlist(STARTER_TOKENS),
    tokens: STARTER_TOKENS,
    source: "starter_fallback",
  };
}

/** Look up a token by symbol within a loaded token set (case-insensitive). */
export function findBySymbol(tokens: EligibleToken[], symbol: string): EligibleToken | undefined {
  return tokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}
