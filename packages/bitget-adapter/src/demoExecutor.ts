/**
 * Official Bitget Demo Trading executor (§4.3 priority 1).
 *
 * Places REAL orders against Bitget's official Demo Trading environment through
 * the official Agent Hub MCP server started with `--paper-trading` (every
 * request carries the `paptrading: 1` header; requires a Demo Trading API key
 * created from Bitget's demo-trading section). Fills come back from Bitget's
 * own matching engine — real exchange demo fills, labeled
 * `official_bitget_demo`, never internal simulations.
 *
 * Fail-loud rules: partial credentials refuse to construct; a rejected order,
 * a non-ok envelope, or an unparseable payload throws BitgetApiError. An order
 * that was accepted but has no fill record yet is returned as `submitted`
 * (never invented as filled).
 */

import { BitgetApiError } from "./marketData.js";
import { BitgetMcpClient } from "./mcpClient.js";
import type { McpToolCaller } from "./mcpMarketData.js";

export interface BitgetDemoCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

const CRED_VARS = ["BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"] as const;

/** The env vars still missing for demo trading (empty array = complete). */
export function missingDemoCredentials(env: NodeJS.ProcessEnv = process.env): string[] {
  return CRED_VARS.filter((v) => !env[v]);
}

/** All three demo credentials, or null if any is missing. */
export function demoCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BitgetDemoCredentials | null {
  if (missingDemoCredentials(env).length > 0) return null;
  return {
    apiKey: env.BITGET_API_KEY!,
    secretKey: env.BITGET_API_SECRET!,
    passphrase: env.BITGET_API_PASSPHRASE!,
  };
}

export interface DemoFill {
  tradeId: string;
  price: number;
  /** Base quantity of this fill. */
  size: number;
  /** Quote (USDT) value of this fill. */
  amount: number;
  timestamp: string;
}

export interface DemoOrderResult {
  orderId: string;
  clientOid?: string;
  symbol: string;
  side: "buy" | "sell";
  /** filled = Bitget returned fill records; submitted = accepted, fills pending. */
  status: "filled" | "submitted";
  fills: DemoFill[];
  /** Volume-weighted average fill price (undefined until fills arrive). */
  avgFillPrice?: number;
  filledQuantity: number;
  filledQuoteUsd: number;
  placedAt: string;
  source: "official_bitget_demo";
  demoTrading: true;
}

/** Execution surface the reactor agent depends on (fakeable in tests). */
export interface DemoSpotExecutor {
  marketBuy(args: {
    symbol: string;
    quoteNotionalUsd: number;
    clientOid?: string;
  }): Promise<DemoOrderResult>;
  marketSell(args: {
    symbol: string;
    baseQuantity: number;
    clientOid?: string;
  }): Promise<DemoOrderResult>;
}

interface McpEnvelope {
  ok?: boolean;
  data?: { data?: unknown };
}

function unwrap(env: McpEnvelope, tool: string): unknown {
  if (!env || env.ok !== true) {
    throw new BitgetApiError(`Bitget MCP tool ${tool} did not succeed (ok=${env?.ok})`);
  }
  return env.data?.data;
}

function num(v: unknown, field: string): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (!Number.isFinite(n)) {
    throw new BitgetApiError(`Bitget demo fill field ${field} not numeric: ${String(v)}`);
  }
  return n;
}

export class OfficialBitgetDemoExecutor implements DemoSpotExecutor {
  constructor(
    private readonly client: McpToolCaller,
    private readonly opts: { fillPollAttempts?: number; fillPollDelayMs?: number } = {},
  ) {}

  /**
   * Spawn a dedicated MCP server in Demo Trading mode (spot module, writes
   * enabled) and wrap it. Throws if credentials are incomplete — never starts
   * a trading-capable server without the full set.
   */
  static spawn(
    creds: BitgetDemoCredentials | null,
  ): { executor: OfficialBitgetDemoExecutor; client: BitgetMcpClient } {
    if (!creds) {
      throw new BitgetApiError(
        `Official Bitget demo trading needs a complete Demo Trading API key set: ` +
          `${CRED_VARS.join(", ")}. Create one in Bitget's demo-trading section and ` +
          `set all three in .env — the executor refuses to start on partial credentials.`,
      );
    }
    const client = new BitgetMcpClient({
      apiKey: creds.apiKey,
      secretKey: creds.secretKey,
      passphrase: creds.passphrase,
      modules: "spot",
      readOnly: false,
      paperTrading: true,
    });
    return { executor: new OfficialBitgetDemoExecutor(client), client };
  }

  /** Market buy sized in quote (USDT) notional, per Bitget v2 market-buy semantics. */
  async marketBuy(args: {
    symbol: string;
    quoteNotionalUsd: number;
    clientOid?: string;
  }): Promise<DemoOrderResult> {
    return this.placeMarket({
      symbol: args.symbol,
      side: "buy",
      size: args.quoteNotionalUsd,
      clientOid: args.clientOid,
    });
  }

  /** Market sell sized in base quantity, per Bitget v2 market-sell semantics. */
  async marketSell(args: {
    symbol: string;
    baseQuantity: number;
    clientOid?: string;
  }): Promise<DemoOrderResult> {
    return this.placeMarket({
      symbol: args.symbol,
      side: "sell",
      size: args.baseQuantity,
      clientOid: args.clientOid,
    });
  }

  private async placeMarket(args: {
    symbol: string;
    side: "buy" | "sell";
    size: number;
    clientOid?: string;
  }): Promise<DemoOrderResult> {
    if (!(args.size > 0)) {
      throw new BitgetApiError(`Bitget demo order size must be positive (got ${args.size})`);
    }
    const placedAt = new Date().toISOString();
    const order: Record<string, unknown> = {
      symbol: args.symbol,
      side: args.side,
      orderType: "market",
      force: "gtc",
      size: String(args.size),
      ...(args.clientOid ? { clientOid: args.clientOid } : {}),
    };
    const env = await this.client.callTool<McpEnvelope>("spot_place_order", { orders: [order] });
    const payload = unwrap(env, "spot_place_order") as Record<string, unknown> | undefined;

    // Single-order shape {orderId} or batch shape {successList, failureList}.
    let orderId = typeof payload?.orderId === "string" ? payload.orderId : undefined;
    let clientOid = typeof payload?.clientOid === "string" ? payload.clientOid : args.clientOid;
    if (!orderId && payload && Array.isArray(payload.successList)) {
      const ok = payload.successList[0] as Record<string, unknown> | undefined;
      orderId = typeof ok?.orderId === "string" ? ok.orderId : undefined;
      clientOid = typeof ok?.clientOid === "string" ? ok.clientOid : clientOid;
      const failures = Array.isArray(payload.failureList) ? payload.failureList : [];
      if (!orderId && failures.length > 0) {
        throw new BitgetApiError(
          `Bitget demo order rejected: ${JSON.stringify(failures[0]).slice(0, 200)}`,
        );
      }
    }
    if (!orderId) {
      throw new BitgetApiError(
        `Bitget demo order returned no orderId: ${JSON.stringify(payload).slice(0, 200)}`,
      );
    }

    const fills = await this.pollFills(args.symbol, orderId);
    const filledQuantity = fills.reduce((s, f) => s + f.size, 0);
    const filledQuoteUsd = fills.reduce((s, f) => s + f.amount, 0);
    return {
      orderId,
      clientOid,
      symbol: args.symbol,
      side: args.side,
      status: fills.length > 0 ? "filled" : "submitted",
      fills,
      avgFillPrice: filledQuantity > 0 ? filledQuoteUsd / filledQuantity : undefined,
      filledQuantity,
      filledQuoteUsd,
      placedAt,
      source: "official_bitget_demo",
      demoTrading: true,
    };
  }

  /** Fill records can lag a market order by a moment; retry briefly, never invent. */
  private async pollFills(symbol: string, orderId: string): Promise<DemoFill[]> {
    const attempts = this.opts.fillPollAttempts ?? 5;
    const delayMs = this.opts.fillPollDelayMs ?? 800;
    for (let i = 0; i < attempts; i++) {
      const env = await this.client.callTool<McpEnvelope>("spot_get_fills", { symbol, orderId });
      const rows = unwrap(env, "spot_get_fills");
      const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
      if (list.length > 0) {
        return list.map((r) => ({
          tradeId: String(r.tradeId ?? ""),
          price: num(r.priceAvg ?? r.price, "price"),
          size: num(r.size, "size"),
          amount: num(r.amount, "amount"),
          timestamp: new Date(Number(r.cTime ?? Date.now())).toISOString(),
        }));
      }
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    return [];
  }
}
