import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliTwakExecutor, TwakCliError, type TwakIntent } from "../src/index.js";
import type { EligibleToken } from "@wardenclaw/core";

const USDT = "0x55d398326f99059ff775485246999027b3197955";
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const tokens: EligibleToken[] = [
  { symbol: "USDT", cmcId: 825, bscContractAddress: USDT, decimals: 18, isStable: true },
  { symbol: "CAKE", cmcId: 7186, bscContractAddress: CAKE, decimals: 18 },
];

let dir: string;
let stubBin: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "twak-cli-"));
  stubBin = join(dir, "twak-stub.sh");
  // A stub that mimics the real `twak --json` output for each subcommand.
  writeFileSync(
    stubBin,
    `#!/bin/sh
echo '{"address":"0xAGENTWALLET","hash":"0xTXHASH","registered":true,"participant":"0xAGENTWALLET","confirmed":false,"amountOut":42.5,"explorer":"https://bscscan.com/tx/0xTXHASH"}'
`,
    "utf8",
  );
  chmodSync(stubBin, 0o755);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function intent(over: Partial<TwakIntent> = {}): TwakIntent {
  return {
    kind: "swap",
    chainId: 56,
    executionType: "spot_only",
    router: "pancakeswap",
    spender: "0xrouter",
    to: "0xrouter",
    tokenInAddress: USDT,
    tokenOutAddress: CAKE,
    amountInUsd: 15,
    txValueWei: "0",
    isInfiniteApproval: false,
    slippageBps: 50,
    isNonSpot: false,
    decodedAction: "enter_long",
    mandateAction: "enter_long",
    ...over,
  };
}

describe("CliTwakExecutor (real subprocess against a stub binary)", () => {
  it("resolves the agent wallet from `twak wallet status`", async () => {
    const ex = new CliTwakExecutor({ tokens, bin: stubBin });
    expect(await ex.resolveAgentWallet()).toBe("0xAGENTWALLET");
  });

  it("signs a spot swap and parses the tx hash", async () => {
    const ex = new CliTwakExecutor({ tokens, bin: stubBin });
    const r = await ex.signAndSubmit(intent());
    expect(r.txHash).toBe("0xTXHASH");
    expect(r.status).toBe("submitted");
    expect(r.realizedOut).toBe(42.5);
  });

  it("registers and returns the registration tx hash", async () => {
    const ex = new CliTwakExecutor({ tokens, bin: stubBin });
    const r = await ex.registerForCompetition("0x212c61b9b72c95d95bf29cf032f5e5635629aed5");
    expect(r.registered).toBe(true);
    expect(r.registrationTxHash).toBe("0xTXHASH");
  });

  it("refuses to swap an unmapped contract", async () => {
    const ex = new CliTwakExecutor({ tokens, bin: stubBin });
    await expect(ex.signAndSubmit(intent({ tokenOutAddress: "0xdead" }))).rejects.toBeInstanceOf(TwakCliError);
  });

  it("refuses a non-spot intent (defense in depth)", async () => {
    const ex = new CliTwakExecutor({ tokens, bin: stubBin });
    await expect(ex.signAndSubmit(intent({ isNonSpot: true }))).rejects.toThrow(/non-spot/);
  });

  it("fails loud when the CLI is missing", async () => {
    const ex = new CliTwakExecutor({ tokens, bin: "definitely-not-a-real-binary-xyz" });
    await expect(ex.resolveAgentWallet()).rejects.toThrow(/not installed|not on PATH/);
  });

  it("x402 fails loud directing to the CMC x402 client", async () => {
    const ex = new CliTwakExecutor({ tokens, bin: stubBin });
    await expect(ex.payX402({ url: "u", maxAmount: "0.01", asset: "USDC" })).rejects.toThrow(/CmcX402Client/);
  });
});
