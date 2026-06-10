/**
 * Eligible-token allowlist, keyed by exact BEP-20 contract address.
 *
 * Symbols are ambiguous on BSC (B, M, U, H, BRETT, TOSHI, REAL, OPEN and others
 * have multiple contracts), so eligibility is asserted on contract address, never
 * on symbol. Native BNB and WBNB are NOT eligible to HOLD as a position: BNB is
 * gas only, WBNB may appear only as an intermediate route hop.
 */

import { RejectCode } from "./types.js";

/** WBNB on BSC mainnet — allowed as a route hop only, never as a held position. */
export const WBNB_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

/**
 * The eligible symbols as enumerated on the competition page. Used by the builder
 * script to resolve each to its CMC-listed BEP-20 contract. Recorded discrepancy:
 * the page states 149 tokens but enumerates fewer, with SLX duplicated and both
 * USDf and USDF present — treated as the working truth, flagged for the organizer.
 */
export const ENUMERATED_ELIGIBLE_SYMBOLS: readonly string[] = [
  "ETH", "USDT", "USDC", "XRP", "TRX", "DOGE", "ZEC", "ADA", "LINK", "BCH", "DAI", "TON",
  "USD1", "USDe", "M", "LTC", "AVAX", "SHIB", "XAUt", "WLFI", "H", "DOT", "UNI", "ASTER",
  "DEXE", "USDD", "ETC", "AAVE", "ATOM", "U", "STABLE", "FIL", "INJ", "币安人生", "NIGHT",
  "FET", "TUSD", "BONK", "PENGU", "CAKE", "SIREN", "LUNC", "ZRO", "KITE", "FDUSD", "BEAT",
  "PIEVERSE", "BTT", "NFT", "EDGE", "FLOKI", "LDO", "B", "FF", "PENDLE", "NEX", "STG",
  "AXS", "TWT", "HOME", "RAY", "COMP", "GWEI", "XCN", "GENIUS", "XPL", "BAT", "SKYAI",
  "APE", "IP", "SFP", "TAG", "NXPC", "AB", "SAHARA", "1INCH", "CHEEMS", "BANANAS31",
  "RIVER", "MYX", "RAVE", "SNX", "FORM", "LAB", "HTX", "USDf", "CTM", "BDX", "SLX", "UB",
  "DUCKY", "FRAX", "BILL", "WFI", "KOGE", "ALE", "FRXUSD", "USDF", "GOMINING", "VCNT",
  "GUA", "DUSD", "SMILEK", "0G", "BEAM", "MY", "SOON", "REAL", "Q", "AIOZ", "ZIG", "YFI",
  "TAC", "lisUSD", "CYS", "ZAMA", "TRIA", "HUMA", "PLUME", "ZIL", "XPR", "ZETA",
  "BabyDoge", "NILA", "ROSE", "VELO", "UAI", "BRETT", "OPEN", "BSB", "TOSHI", "BAS",
  "ACH", "AXL", "LUR", "ELF", "KAVA", "APR", "IRYS", "EURI", "XUSD", "BARD", "DUSK",
  "SUSHI", "PEAQ", "COAI", "BDCA", "XAUM",
];

export interface EligibleToken {
  symbol: string;
  cmcId: number;
  bscContractAddress: string;
  decimals: number;
  /** Whether this token is a stablecoin (parking + scout legs). */
  isStable?: boolean;
}

/**
 * An address-keyed allowlist built from the resolved eligible-token file. All
 * lookups normalize addresses to lowercase.
 */
export class EligibleAllowlist {
  private readonly byAddress = new Map<string, EligibleToken>();

  constructor(tokens: EligibleToken[]) {
    for (const t of tokens) {
      this.byAddress.set(t.bscContractAddress.toLowerCase(), t);
    }
  }

  static fromJson(tokens: EligibleToken[]): EligibleAllowlist {
    return new EligibleAllowlist(tokens);
  }

  get size(): number {
    return this.byAddress.size;
  }

  /** True if the address is an eligible token that may be HELD as a position. */
  isEligible(address: string): boolean {
    return this.byAddress.has(address.toLowerCase());
  }

  get(address: string): EligibleToken | undefined {
    return this.byAddress.get(address.toLowerCase());
  }

  /** True for native BNB (zero address / sentinel) or WBNB — never holdable. */
  static isNativeOrWbnb(address: string): boolean {
    const a = address.toLowerCase();
    return (
      a === WBNB_ADDRESS ||
      a === "0x0000000000000000000000000000000000000000" ||
      a === "bnb" ||
      a === "native"
    );
  }
}

export interface LegEligibility {
  ok: boolean;
  rejectCode?:
    | typeof RejectCode.INELIGIBLE_CONTRACT
    | typeof RejectCode.HELD_NATIVE_OR_WBNB;
  reason: string;
}

/**
 * Assert that both legs of a spot swap are eligible to HOLD: each must be on the
 * address-keyed allowlist, and neither may be native BNB or WBNB (those are gas /
 * route-hop only). WBNB appearing strictly as an internal route hop is handled by
 * the router layer, not here — this checks the positions the agent ends up holding.
 */
export function assertLegsEligible(
  tokenInAddress: string,
  tokenOutAddress: string,
  allowlist: EligibleAllowlist,
): LegEligibility {
  for (const [label, addr] of [
    ["tokenIn", tokenInAddress],
    ["tokenOut", tokenOutAddress],
  ] as const) {
    if (EligibleAllowlist.isNativeOrWbnb(addr)) {
      return {
        ok: false,
        rejectCode: RejectCode.HELD_NATIVE_OR_WBNB,
        reason: `${label} ${addr} is native BNB/WBNB — cannot be held as a position`,
      };
    }
    if (!allowlist.isEligible(addr)) {
      return {
        ok: false,
        rejectCode: RejectCode.INELIGIBLE_CONTRACT,
        reason: `${label} ${addr} is not on the eligible address-keyed allowlist`,
      };
    }
  }
  return { ok: true, reason: "both legs eligible and holdable" };
}
