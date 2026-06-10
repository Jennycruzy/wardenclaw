/**
 * PancakeSwap spot quote interface + a constant-product quote model.
 *
 * Reading chain state (reserves, quotes, staticcall simulation) is allowed;
 * EXECUTION is TWAK-only (§5.4). The QuoteProvider is the read surface. The
 * constant-product helper computes expected output and price impact from real
 * pool reserves — used for the friction estimate and the shadow-fill check. The
 * default provider fails loudly until a real RPC-backed quoter is wired.
 */

export interface SwapQuote {
  /** Expected output amount (token units) for the requested input. */
  amountOut: number;
  /** Price impact in bps vs the mid (spot) price. */
  priceImpactBps: number;
  /** Mid price (out per in) before impact. */
  midPrice: number;
}

export interface QuoteRequest {
  tokenInAddress: string;
  tokenOutAddress: string;
  amountIn: number;
}

export interface QuoteProvider {
  readonly configured: boolean;
  /** A current quote from chain state. */
  quote(req: QuoteRequest): Promise<SwapQuote>;
  /** Simulate the exact swap against current chain state (for shadow-fill). */
  simulate(req: QuoteRequest): Promise<SwapQuote>;
}

const NOT_CONFIGURED =
  "BSC quote provider not configured. Provide a real RPC-backed PancakeSwap quoter " +
  "(BSC_RPC_URLS). WARDENCLAW never fabricates a quote — reads fail loudly.";

export class UnconfiguredQuoteProvider implements QuoteProvider {
  readonly configured = false;
  async quote(_req: QuoteRequest): Promise<SwapQuote> {
    throw new Error(NOT_CONFIGURED);
  }
  async simulate(_req: QuoteRequest): Promise<SwapQuote> {
    throw new Error(NOT_CONFIGURED);
  }
}

/**
 * Constant-product (x*y=k) output for given reserves, with the pool fee applied.
 * This is the standard PancakeSwap V2 math; with REAL reserves it produces a real
 * quote, and it lets tests model price impact deterministically.
 */
export function constantProductOut(args: {
  amountIn: number;
  reserveIn: number;
  reserveOut: number;
  feeBps: number;
}): SwapQuote {
  if (args.reserveIn <= 0 || args.reserveOut <= 0) {
    throw new Error("constantProductOut: reserves must be positive");
  }
  const midPrice = args.reserveOut / args.reserveIn;
  const amountInAfterFee = args.amountIn * (1 - args.feeBps / 10_000);
  const amountOut = (amountInAfterFee * args.reserveOut) / (args.reserveIn + amountInAfterFee);
  const effectivePrice = amountOut / args.amountIn;
  const priceImpactBps = Math.max(0, (1 - effectivePrice / midPrice) * 10_000);
  return { amountOut, priceImpactBps, midPrice };
}

/**
 * Expected DEPTH slippage in bps for a notional, from real pool reserves —
 * EXCLUDING the LP fee (the friction model adds the fee separately, so including
 * it here would double-count). This is the pure price impact of trade size
 * against pool depth.
 */
export function expectedSlippageBps(args: {
  amountIn: number;
  reserveIn: number;
  reserveOut: number;
  /** Accepted for signature symmetry; not used (fee is charged separately). */
  feeBps?: number;
}): number {
  if (args.reserveIn <= 0 || args.reserveOut <= 0) {
    throw new Error("expectedSlippageBps: reserves must be positive");
  }
  const midPrice = args.reserveOut / args.reserveIn;
  const out = (args.amountIn * args.reserveOut) / (args.reserveIn + args.amountIn);
  const effectivePrice = out / args.amountIn;
  return Math.max(0, (1 - effectivePrice / midPrice) * 10_000);
}
