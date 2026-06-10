/**
 * Live BSC chain reader (viem) — REAL PancakeSwap V2 reads against mainnet.
 *
 * Reading chain state is allowed; execution stays TWAK-only (§5.4). This provides
 * the real reserves, on-chain quote, staticcall simulation (shadow-fill), and gas
 * price the pipeline needs. It uses a fallback transport across the RPC pool so a
 * dead endpoint never hangs the loop. No fabrication: a missing pool or a failed
 * call throws.
 */

import { createPublicClient, fallback, http, parseAbi, getAddress, type PublicClient } from "viem";
import { bsc } from "viem/chains";

const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
]);
const FACTORY_ABI = parseAbi(["function getPair(address tokenA, address tokenB) view returns (address)"]);
const PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
]);

/** PancakeSwap V2 factory on BSC mainnet. */
export const PANCAKE_V2_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";

export interface LiveReserves {
  /** Reserve of tokenIn in human units. */
  reserveIn: number;
  /** Reserve of tokenOut in human units. */
  reserveOut: number;
  pairAddress: string;
}

export interface LiveQuote {
  amountOut: number; // human units
  amountOutWei: bigint;
}

export class NoPoolError extends Error {
  constructor(a: string, b: string) {
    super(`No PancakeSwap V2 pool for ${a} / ${b}`);
    this.name = "NoPoolError";
  }
}

export interface LiveBscReaderOptions {
  rpcUrls: string[];
  routerAddress?: string;
  factoryAddress?: string;
}

const ZERO = "0x0000000000000000000000000000000000000000";

export class LiveBscReader {
  private readonly client: PublicClient;
  private readonly router: `0x${string}`;
  private readonly factory: `0x${string}`;

  constructor(opts: LiveBscReaderOptions) {
    if (!opts.rpcUrls.length) throw new Error("LiveBscReader requires at least one RPC URL.");
    this.client = createPublicClient({
      chain: bsc,
      transport: fallback(opts.rpcUrls.map((u) => http(u, { timeout: 8000 }))),
    });
    this.router = getAddress(opts.routerAddress ?? "0x10ED43C718714eb63d5aA57B78B54704E256024E");
    this.factory = getAddress(opts.factoryAddress ?? PANCAKE_V2_FACTORY);
  }

  /** Confirm we are pinned to BSC mainnet (chainId 56). */
  async assertChain(): Promise<void> {
    const id = await this.client.getChainId();
    if (id !== 56) throw new Error(`RPC chainId ${id} != 56 (BSC mainnet)`);
  }

  /** Real pool reserves for a directional pair, normalized to human units. */
  async getReserves(
    tokenIn: string,
    tokenOut: string,
    decimalsIn: number,
    decimalsOut: number,
  ): Promise<LiveReserves> {
    const a = getAddress(tokenIn);
    const b = getAddress(tokenOut);
    const pair = (await this.client.readContract({
      address: this.factory,
      abi: FACTORY_ABI,
      functionName: "getPair",
      args: [a, b],
    })) as `0x${string}`;
    if (pair.toLowerCase() === ZERO) throw new NoPoolError(tokenIn, tokenOut);

    const [reserves, token0] = await Promise.all([
      this.client.readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" }) as Promise<readonly [bigint, bigint, number]>,
      this.client.readContract({ address: pair, abi: PAIR_ABI, functionName: "token0" }) as Promise<`0x${string}`>,
    ]);
    const inIsToken0 = token0.toLowerCase() === a.toLowerCase();
    const reserveInRaw = inIsToken0 ? reserves[0] : reserves[1];
    const reserveOutRaw = inIsToken0 ? reserves[1] : reserves[0];
    return {
      reserveIn: Number(reserveInRaw) / 10 ** decimalsIn,
      reserveOut: Number(reserveOutRaw) / 10 ** decimalsOut,
      pairAddress: pair,
    };
  }

  /** Real on-chain quote via the router (current chain state). */
  async getAmountOut(
    tokenIn: string,
    tokenOut: string,
    amountInHuman: number,
    decimalsIn: number,
    decimalsOut: number,
  ): Promise<LiveQuote> {
    const amountInWei = BigInt(Math.floor(amountInHuman * 10 ** decimalsIn));
    const amounts = (await this.client.readContract({
      address: this.router,
      abi: ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [amountInWei, [getAddress(tokenIn), getAddress(tokenOut)]],
    })) as readonly bigint[];
    const outWei = amounts[amounts.length - 1]!;
    return { amountOut: Number(outWei) / 10 ** decimalsOut, amountOutWei: outWei };
  }

  /** Current gas price in wei (for the friction model). */
  async getGasPriceWei(): Promise<bigint> {
    return this.client.getGasPrice();
  }

  /** USD gas cost for one swap leg, given the BNB price. */
  async gasPerLegUsd(bnbPriceUsd: number, gasUnits = 160_000): Promise<number> {
    const gasPriceWei = await this.getGasPriceWei();
    const bnbCost = Number(gasPriceWei * BigInt(gasUnits)) / 1e18;
    return bnbCost * bnbPriceUsd;
  }
}
