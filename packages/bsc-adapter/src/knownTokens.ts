/**
 * Canonical BNB Smart Chain mainnet contract addresses for the starter tradeable
 * universe (§0.1a tiers). These are real, publicly verifiable mainnet contracts —
 * not fabricated — and serve as a documented fallback for local/dry runs.
 *
 * The AUTHORITATIVE eligible list is data/eligible-tokens.json, resolved from CMC
 * by `pnpm build:eligible-tokens`. Always prefer that file; this set lets the
 * agent run and the dashboards render against real addresses before it exists.
 */

import type { EligibleToken } from "@wardenclaw/core";

/** PancakeSwap V2 router on BSC mainnet. */
export const PANCAKE_V2_ROUTER = "0x10ed43c718714eb63d5aa57b78b54704e256024e";

/** Stables tier — parking + Micro-Scout legs. */
export const STARTER_STABLES: EligibleToken[] = [
  { symbol: "USDT", cmcId: 825, bscContractAddress: "0x55d398326f99059ff775485246999027b3197955", decimals: 18, isStable: true },
  { symbol: "USDC", cmcId: 3408, bscContractAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimals: 18, isStable: true },
  { symbol: "DAI", cmcId: 4943, bscContractAddress: "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3", decimals: 18, isStable: true },
  { symbol: "FDUSD", cmcId: 26081, bscContractAddress: "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409", decimals: 18, isStable: true },
  { symbol: "TUSD", cmcId: 2563, bscContractAddress: "0x14016e85a25aeb13065688cafb43044c2ef86784", decimals: 18, isStable: true },
  { symbol: "FRAX", cmcId: 6952, bscContractAddress: "0x90c97f71e18723b0cf0dfa30ee176ab653e89f40", decimals: 18, isStable: true },
];

/** Liquid-majors tier — momentum family. */
export const STARTER_MAJORS: EligibleToken[] = [
  { symbol: "CAKE", cmcId: 7186, bscContractAddress: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", decimals: 18 },
  { symbol: "TWT", cmcId: 5964, bscContractAddress: "0x4b0f1812e5df2a09796481ff14017e6005508003", decimals: 18 },
  { symbol: "ETH", cmcId: 1027, bscContractAddress: "0x2170ed0880ac9a755fd29b2688956bd959f933f8", decimals: 18 },
  { symbol: "XRP", cmcId: 52, bscContractAddress: "0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe", decimals: 18 },
  { symbol: "LINK", cmcId: 1975, bscContractAddress: "0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd", decimals: 18 },
  { symbol: "ADA", cmcId: 2010, bscContractAddress: "0x3ee2200efb3400fabb9aacf31297cbdd1d435d47", decimals: 18 },
  { symbol: "DOT", cmcId: 6636, bscContractAddress: "0x7083609fce4d1d8dc0c979aab8c869ea2c873402", decimals: 18 },
  { symbol: "UNI", cmcId: 7083, bscContractAddress: "0xbf5140a22578168fd562dccf235e5d43a02ce9b1", decimals: 18 },
  { symbol: "LTC", cmcId: 2, bscContractAddress: "0x4338665cbb7b2485a8855a139b75d5e34ab0db94", decimals: 18 },
  { symbol: "DOGE", cmcId: 74, bscContractAddress: "0xba2ae424d960c26247dd6c32edc70b295c744c43", decimals: 8 },
];

/** The full starter universe: real canonical addresses for stables + majors. */
export const STARTER_TOKENS: EligibleToken[] = [...STARTER_STABLES, ...STARTER_MAJORS];

export const DEFAULT_MICRO_SCOUT_PAIR = {
  fromSymbol: "USDT",
  toSymbol: "USDC",
} as const;
