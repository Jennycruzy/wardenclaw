import { describe, it, expect } from "vitest";
import {
  OfficialBitgetDemoExecutor,
  demoCredentialsFromEnv,
  missingDemoCredentials,
} from "../src/demoExecutor.js";
import type { McpToolCaller } from "../src/mcpMarketData.js";

const FULL_ENV = {
  BITGET_API_KEY: "bg_x",
  BITGET_API_SECRET: "s",
  BITGET_API_PASSPHRASE: "p",
} as NodeJS.ProcessEnv;

function fakeClient(handlers: Record<string, (args: Record<string, unknown>) => unknown>): McpToolCaller & {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      calls.push({ name, args });
      const h = handlers[name];
      if (!h) throw new Error(`unexpected tool ${name}`);
      return h(args) as T;
    },
  };
}

const env = (data: unknown) => ({ ok: true, data: { data } });

describe("demo credentials gating", () => {
  it("reports each missing var and returns null creds until complete", () => {
    expect(missingDemoCredentials({ BITGET_API_KEY: "k" } as NodeJS.ProcessEnv)).toEqual([
      "BITGET_API_SECRET",
      "BITGET_API_PASSPHRASE",
    ]);
    expect(demoCredentialsFromEnv({ BITGET_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
    expect(demoCredentialsFromEnv(FULL_ENV)).toEqual({
      apiKey: "bg_x",
      secretKey: "s",
      passphrase: "p",
    });
  });
});

describe("OfficialBitgetDemoExecutor", () => {
  it("places a quote-sized market buy and aggregates real fills", async () => {
    const client = fakeClient({
      spot_place_order: () => env({ successList: [{ orderId: "o1", clientOid: "c1" }], failureList: [] }),
      spot_get_fills: () =>
        env([
          { tradeId: "t1", priceAvg: "200", size: "0.05", amount: "10", cTime: "1781189000000" },
          { tradeId: "t2", priceAvg: "201", size: "0.05", amount: "10.05", cTime: "1781189001000" },
        ]),
    });
    const ex = new OfficialBitgetDemoExecutor(client);
    const res = await ex.marketBuy({ symbol: "NVDAONUSDT", quoteNotionalUsd: 20.05, clientOid: "c1" });

    expect(client.calls[0]).toEqual({
      name: "spot_place_order",
      args: {
        orders: [
          {
            symbol: "NVDAONUSDT",
            side: "buy",
            orderType: "market",
            force: "gtc",
            size: "20.05",
            clientOid: "c1",
          },
        ],
      },
    });
    expect(res.status).toBe("filled");
    expect(res.orderId).toBe("o1");
    expect(res.filledQuantity).toBeCloseTo(0.1);
    expect(res.filledQuoteUsd).toBeCloseTo(20.05);
    expect(res.avgFillPrice).toBeCloseTo(200.5);
    expect(res.source).toBe("official_bitget_demo");
  });

  it("throws on a rejected order instead of inventing a fill", async () => {
    const client = fakeClient({
      spot_place_order: () =>
        env({ successList: [], failureList: [{ errorMsg: "insufficient balance" }] }),
    });
    const ex = new OfficialBitgetDemoExecutor(client);
    await expect(ex.marketBuy({ symbol: "NVDAONUSDT", quoteNotionalUsd: 20 })).rejects.toThrow(
      /rejected.*insufficient balance/,
    );
  });

  it("throws on a non-ok envelope", async () => {
    const client = fakeClient({ spot_place_order: () => ({ ok: false }) });
    const ex = new OfficialBitgetDemoExecutor(client);
    await expect(ex.marketBuy({ symbol: "NVDAONUSDT", quoteNotionalUsd: 20 })).rejects.toThrow(
      /did not succeed/,
    );
  });

  it("returns submitted (not filled) when fills have not landed", async () => {
    const client = fakeClient({
      spot_place_order: () => env({ orderId: "o2" }),
      spot_get_fills: () => env([]),
    });
    const ex = new OfficialBitgetDemoExecutor(client, { fillPollAttempts: 2, fillPollDelayMs: 1 });
    const res = await ex.marketBuy({ symbol: "NVDAONUSDT", quoteNotionalUsd: 20 });
    expect(res.status).toBe("submitted");
    expect(res.fills).toEqual([]);
    expect(res.avgFillPrice).toBeUndefined();
  });

  it("sizes market sells in base quantity", async () => {
    const client = fakeClient({
      spot_place_order: () => env({ orderId: "o3" }),
      spot_get_fills: () =>
        env([{ tradeId: "t", priceAvg: "200", size: "0.1", amount: "20", cTime: "1781189000000" }]),
    });
    const ex = new OfficialBitgetDemoExecutor(client);
    const res = await ex.marketSell({ symbol: "NVDAONUSDT", baseQuantity: 0.1 });
    expect(client.calls[0]!.args).toMatchObject({
      orders: [{ side: "sell", orderType: "market", size: "0.1" }],
    });
    expect(res.status).toBe("filled");
  });

  it("rejects a non-positive order size before any tool call", async () => {
    const client = fakeClient({});
    const ex = new OfficialBitgetDemoExecutor(client);
    await expect(ex.marketBuy({ symbol: "NVDAONUSDT", quoteNotionalUsd: 0 })).rejects.toThrow(
      /must be positive/,
    );
    expect(client.calls).toEqual([]);
  });
});
