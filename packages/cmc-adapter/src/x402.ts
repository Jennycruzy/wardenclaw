/**
 * Real CMC x402 client — pay-per-request CMC data, settled in USDC on Base via an
 * off-chain EIP-3009 `transferWithAuthorization` signature ($0.01/request, no API
 * key). This is the x402-in-the-trade-loop path (§0.6).
 *
 * The 402 response is self-describing: the client reads the payment requirements
 * the server sends (payTo, amount, asset, validity) rather than hardcoding them,
 * so it adapts to CMC's live challenge. Signing uses viem with a Base account from
 * X402_PRIVATE_KEY; without that key (or without USDC) it FAILS LOUD — it never
 * fabricates a receipt. `fetch` and the nonce source are injectable for testing.
 *
 * Endpoints (from CMC docs): https://pro-api.coinmarketcap.com/x402/...
 *   /x402/v3/cryptocurrency/quotes/latest, /x402/v1/dex/search, etc.
 */

import { webcrypto } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { type Account } from "viem";
import type { X402Receipt } from "@wardenclaw/twak-adapter";

/** USDC on Base — the x402 settlement asset (EIP-3009 domain). */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_CHAIN_ID = 8453;

export type X402Fetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface PaymentRequirement {
  scheme: string;
  network: string;
  /** Amount required in the asset's smallest unit (USDC has 6 decimals). */
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  resource?: string;
  /** Validity window in seconds (optional; defaults applied). */
  maxTimeoutSeconds?: number;
}

export interface CmcX402Options {
  privateKey?: string;
  baseUrl?: string;
  fetchImpl?: X402Fetch;
  /** 32-byte hex nonce source (injected for deterministic tests). */
  nonceFactory?: () => `0x${string}`;
  /** Clock in ms (injected for tests). */
  now?: () => number;
}

export class CmcX402Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CmcX402Error";
  }
}

/** Decode the base64 `Payment-Required` header (or 402 body) into requirements. */
export function parsePaymentRequired(headerOrBody: string): PaymentRequirement {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(headerOrBody, "base64").toString("utf8"));
  } catch {
    json = JSON.parse(headerOrBody);
  }
  const obj = json as Record<string, unknown>;
  const accepts = (obj.accepts as PaymentRequirement[] | undefined)?.[0];
  const req = accepts ?? (obj as unknown as PaymentRequirement);
  if (!req.payTo || !req.maxAmountRequired) {
    throw new CmcX402Error("malformed x402 payment requirement (missing payTo/amount)");
  }
  return req;
}

export class CmcX402Client {
  private readonly account: Account;
  private readonly baseUrl: string;
  private readonly fetchImpl: X402Fetch;
  private readonly nonceFactory: () => `0x${string}`;
  private readonly now: () => number;

  constructor(opts: CmcX402Options = {}) {
    const key = opts.privateKey ?? process.env.X402_PRIVATE_KEY;
    if (!key) {
      throw new CmcX402Error(
        "X402_PRIVATE_KEY (a Base account with USDC) is required for x402 payments. " +
          "WARDENCLAW never fabricates an x402 receipt — it fails loudly without funds.",
      );
    }
    this.account = privateKeyToAccount(key as `0x${string}`);
    this.baseUrl = (opts.baseUrl ?? process.env.CMC_X402_ENDPOINT ?? "https://pro-api.coinmarketcap.com").replace(/\/$/, "");
    const f = opts.fetchImpl ?? (globalThis.fetch as unknown as X402Fetch | undefined);
    if (!f) throw new CmcX402Error("no fetch implementation available");
    this.fetchImpl = f;
    this.nonceFactory =
      opts.nonceFactory ??
      (() => {
        const b = new Uint8Array(32);
        (globalThis.crypto ?? webcrypto).getRandomValues(b);
        return ("0x" + Buffer.from(b).toString("hex")) as `0x${string}`;
      });
    this.now = opts.now ?? (() => Date.now());
  }

  get payerAddress(): string {
    return this.account.address;
  }

  /** Build and sign the EIP-3009 transferWithAuthorization for a requirement. */
  private async signAuthorization(req: PaymentRequirement): Promise<{
    authorization: Record<string, string>;
    signature: string;
  }> {
    const nowSec = Math.floor(this.now() / 1000);
    const authorization = {
      from: this.account.address,
      to: req.payTo,
      value: req.maxAmountRequired,
      validAfter: String(nowSec - 60),
      validBefore: String(nowSec + (req.maxTimeoutSeconds ?? 600)),
      nonce: this.nonceFactory(),
    };
    const signature = await this.account.signTypedData!({
      domain: { name: "USD Coin", version: "2", chainId: BASE_CHAIN_ID, verifyingContract: (req.asset ?? BASE_USDC) as `0x${string}` },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from as `0x${string}`,
        to: authorization.to as `0x${string}`,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as `0x${string}`,
      },
    });
    return { authorization, signature };
  }

  /**
   * GET an x402 endpoint, paying when challenged. Returns the data and a full
   * receipt for the audit trail. Throws on a non-402 error or a failed retry.
   */
  async get(
    path: string,
    params: Record<string, string> = {},
    opts: { mandateId?: string } = {},
  ): Promise<{ data: unknown; receipt: X402Receipt }> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const first = await this.fetchImpl(url);
    if (first.ok) {
      // No payment required (free tier / cached) — still record provenance.
      const data = await first.json();
      return {
        data,
        receipt: this.receipt(url, "0", BASE_USDC, "no-payment-required", "ok", opts.mandateId),
      };
    }
    if (first.status !== 402) {
      throw new CmcX402Error(`CMC x402 unexpected status ${first.status} for ${path}`);
    }

    const challenge = first.headers.get("payment-required") ?? (await first.text());
    const req = parsePaymentRequired(challenge);
    const { authorization, signature } = await this.signAuthorization(req);
    const paymentHeader = Buffer.from(
      JSON.stringify({ x402Version: 1, scheme: req.scheme ?? "exact", network: req.network ?? "base", payload: { signature, authorization } }),
    ).toString("base64");

    const paid = await this.fetchImpl(url, { headers: { "PAYMENT-SIGNATURE": paymentHeader } });
    if (!paid.ok) {
      const body = await paid.text().catch(() => "");
      throw new CmcX402Error(`CMC x402 payment retry failed (${paid.status}): ${body.slice(0, 200)}`);
    }
    const data = await paid.json();
    const settlement = paid.headers.get("payment-response") ?? paid.headers.get("x-payment-response") ?? "settled";
    return {
      data,
      receipt: this.receipt(url, req.maxAmountRequired, req.asset ?? BASE_USDC, settlement, "ok", opts.mandateId),
    };
  }

  private receipt(
    url: string,
    amount: string,
    asset: string,
    receiptId: string,
    summary: string,
    mandateId?: string,
  ): X402Receipt {
    return {
      requestUrl: url,
      amount,
      asset,
      payer: this.account.address,
      recipient: "cmc-x402",
      receipt: receiptId,
      responseSummary: summary,
      mandateId,
      usedInDecision: true,
      timestamp: new Date(this.now()).toISOString(),
    };
  }
}
