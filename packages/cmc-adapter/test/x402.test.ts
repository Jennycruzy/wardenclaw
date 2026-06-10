import { describe, it, expect } from "vitest";
import { CmcX402Client, CmcX402Error, parsePaymentRequired, BASE_USDC, type X402Fetch } from "../src/index.js";

// A funded-looking but throwaway test key (well-known hardhat account #0). Never
// used for real funds — only to exercise real EIP-3009 signing deterministically.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PAYTO = "0x000000000000000000000000000000000000c0de";

function requirement() {
  return {
    scheme: "exact",
    network: "base",
    maxAmountRequired: "10000", // 0.01 USDC (6 decimals)
    payTo: PAYTO,
    asset: BASE_USDC,
    maxTimeoutSeconds: 600,
  };
}

function headers(map: Record<string, string>) {
  return { get: (n: string) => map[n.toLowerCase()] ?? null };
}

describe("parsePaymentRequired", () => {
  it("decodes a base64 challenge with an accepts array", () => {
    const challenge = Buffer.from(JSON.stringify({ accepts: [requirement()] })).toString("base64");
    const req = parsePaymentRequired(challenge);
    expect(req.payTo).toBe(PAYTO);
    expect(req.maxAmountRequired).toBe("10000");
  });

  it("throws on a malformed requirement", () => {
    const bad = Buffer.from(JSON.stringify({ accepts: [{ scheme: "exact" }] })).toString("base64");
    expect(() => parsePaymentRequired(bad)).toThrow(CmcX402Error);
  });
});

describe("CmcX402Client", () => {
  it("requires X402_PRIVATE_KEY (never fabricates a receipt)", () => {
    const saved = process.env.X402_PRIVATE_KEY;
    delete process.env.X402_PRIVATE_KEY;
    expect(() => new CmcX402Client({ fetchImpl: (async () => ({})) as unknown as X402Fetch })).toThrow(CmcX402Error);
    if (saved) process.env.X402_PRIVATE_KEY = saved;
  });

  it("performs the full 402 → sign → retry handshake and returns a receipt", async () => {
    let calls = 0;
    let sentSignature: string | null = null;
    const fetchImpl: X402Fetch = async (_url, init) => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 402,
          headers: headers({ "payment-required": Buffer.from(JSON.stringify({ accepts: [requirement()] })).toString("base64") }),
          json: async () => ({}),
          text: async () => "",
        };
      }
      sentSignature = init?.headers?.["PAYMENT-SIGNATURE"] ?? null;
      return {
        ok: true,
        status: 200,
        headers: headers({ "payment-response": "0xsettlement" }),
        json: async () => ({ data: { CAKE: { quote: { USD: { price: 2.5 } } } } }),
        text: async () => "",
      };
    };

    const client = new CmcX402Client({ privateKey: TEST_KEY, fetchImpl, now: () => 1_750_000_000_000 });
    const { data, receipt } = await client.get("/x402/v3/cryptocurrency/quotes/latest", { symbol: "CAKE" }, { mandateId: "m1" });

    expect(calls).toBe(2);
    expect(sentSignature).toBeTruthy();
    // The signature header is a base64 payload carrying a real 65-byte EIP-712 sig.
    const decoded = JSON.parse(Buffer.from(sentSignature!, "base64").toString("utf8"));
    expect(decoded.payload.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(decoded.payload.authorization.to).toBe(PAYTO);
    expect(receipt.payer).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(receipt.usedInDecision).toBe(true);
    expect(receipt.mandateId).toBe("m1");
    expect((data as { data: unknown }).data).toBeDefined();
  });

  it("returns data without payment when the endpoint is free (200)", async () => {
    const fetchImpl: X402Fetch = async () => ({
      ok: true,
      status: 200,
      headers: headers({}),
      json: async () => ({ ok: true }),
      text: async () => "",
    });
    const client = new CmcX402Client({ privateKey: TEST_KEY, fetchImpl });
    const { receipt } = await client.get("/x402/v1/dex/search", { q: "bnb" });
    expect(receipt.receipt).toBe("no-payment-required");
  });

  it("throws on an unexpected non-402 error", async () => {
    const fetchImpl: X402Fetch = async () => ({
      ok: false,
      status: 500,
      headers: headers({}),
      json: async () => ({}),
      text: async () => "server error",
    });
    const client = new CmcX402Client({ privateKey: TEST_KEY, fetchImpl });
    await expect(client.get("/x402/v1/dex/search")).rejects.toThrow(/unexpected status 500/);
  });
});
