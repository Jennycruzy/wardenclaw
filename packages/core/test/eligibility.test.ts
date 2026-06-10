import { describe, it, expect } from "vitest";
import { EligibleAllowlist, assertLegsEligible, WBNB_ADDRESS } from "../src/index.js";

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";

const allowlist = EligibleAllowlist.fromJson([
  { symbol: "USDT", cmcId: 825, bscContractAddress: USDT, decimals: 18, isStable: true },
  { symbol: "USDC", cmcId: 3408, bscContractAddress: USDC, decimals: 18, isStable: true },
  { symbol: "CAKE", cmcId: 7186, bscContractAddress: CAKE, decimals: 18 },
]);

describe("eligible allowlist", () => {
  it("is address-keyed and case-insensitive", () => {
    expect(allowlist.isEligible(USDT.toLowerCase())).toBe(true);
    expect(allowlist.isEligible(USDT.toUpperCase())).toBe(true);
    expect(allowlist.size).toBe(3);
  });

  it("rejects an off-list contract even with a known symbol", () => {
    const fakeCake = "0x000000000000000000000000000000000000dead";
    const r = assertLegsEligible(USDT, fakeCake, allowlist);
    expect(r.ok).toBe(false);
    expect(r.rejectCode).toBe("REJECT_INELIGIBLE_CONTRACT");
  });

  it("rejects holding native BNB or WBNB as a position", () => {
    expect(assertLegsEligible(USDT, WBNB_ADDRESS, allowlist).rejectCode).toBe(
      "REJECT_HELD_NATIVE_OR_WBNB",
    );
    expect(assertLegsEligible("native", CAKE, allowlist).rejectCode).toBe(
      "REJECT_HELD_NATIVE_OR_WBNB",
    );
    expect(
      assertLegsEligible("0x0000000000000000000000000000000000000000", CAKE, allowlist).rejectCode,
    ).toBe("REJECT_HELD_NATIVE_OR_WBNB");
  });

  it("passes a fully eligible stable↔stable pair", () => {
    expect(assertLegsEligible(USDT, USDC, allowlist).ok).toBe(true);
  });
});
