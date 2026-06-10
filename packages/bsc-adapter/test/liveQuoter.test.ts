import { describe, it, expect } from "vitest";
import { LiveBscReader } from "../src/index.js";

/**
 * Live integration test against REAL BSC mainnet via public RPC. Skipped
 * automatically when the network is unreachable (e.g. offline CI) so the suite
 * stays green, but it exercises the real viem reads when a network is available.
 */

const RPC = (process.env.BSC_RPC_URLS ?? "https://bsc-dataseed.binance.org,https://bsc-dataseed1.defibit.io").split(",");
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";

async function networkUp(): Promise<boolean> {
  try {
    const r = new LiveBscReader({ rpcUrls: RPC });
    await r.assertChain();
    return true;
  } catch {
    return false;
  }
}

describe("LiveBscReader (mainnet)", () => {
  it("reads real reserves and an on-chain quote for USDT→CAKE", async () => {
    if (!(await networkUp())) {
      console.warn("[skip] BSC RPC unreachable — live quoter test skipped");
      return;
    }
    const reader = new LiveBscReader({ rpcUrls: RPC });
    const reserves = await reader.getReserves(USDT, CAKE, 18, 18);
    expect(reserves.reserveIn).toBeGreaterThan(0);
    expect(reserves.reserveOut).toBeGreaterThan(0);
    expect(reserves.pairAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const quote = await reader.getAmountOut(USDT, CAKE, 100, 18, 18);
    expect(quote.amountOut).toBeGreaterThan(0);
    expect(quote.amountOutWei).toBeGreaterThan(0n);

    const gas = await reader.getGasPriceWei();
    expect(gas).toBeGreaterThan(0n);
  }, 30_000);

  it("requires at least one RPC URL", () => {
    expect(() => new LiveBscReader({ rpcUrls: [] })).toThrow();
  });
});
