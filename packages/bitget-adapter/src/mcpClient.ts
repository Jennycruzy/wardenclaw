/**
 * Real client for the official Bitget MCP server (`bitget-mcp-server`, the Agent
 * Hub "Tools" + "MCP Server" layer). Spawns the server as a stdio subprocess,
 * performs the MCP initialize handshake, and calls real Bitget tools over
 * newline-delimited JSON-RPC. It never fabricates data: a missing binary, a
 * non-zero exit, a tool error, or a timeout all reject loudly.
 *
 * Verified tool surface (from `tools/list` on bitget-mcp-server@1.1.0), public
 * read-only endpoints used by WARDENCLAW's perception layer:
 *   spot_get_ticker, spot_get_depth, spot_get_candles, spot_get_trades,
 *   futures_get_funding_rate, futures_get_open_interest
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface BitgetMcpOptions {
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  /** Comma-separated module list (default "spot,futures"). */
  modules?: string;
  /** Read-only mode disables every write/order tool (default true). */
  readOnly?: boolean;
  /** Launch command (default "npx"). */
  bin?: string;
  /** Override the full argv after `bin` (default derived from the options). */
  args?: string[];
  /** Per-request timeout in ms (default 20000). */
  timeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class BitgetMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BitgetMcpError";
  }
}

export class BitgetMcpClient {
  private proc?: ChildProcess;
  private buf = "";
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private starting?: Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly opts: BitgetMcpOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 20000;
  }

  /** Spawn the server and complete the MCP initialize handshake (idempotent). */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const bin = this.opts.bin ?? "npx";
      const args =
        this.opts.args ??
        [
          "-y",
          "bitget-mcp-server",
          ...(this.opts.readOnly === false ? [] : ["--read-only"]),
          "--modules",
          this.opts.modules ?? "spot,futures",
        ];
      // The server rejects PARTIAL credentials, and it inherits process.env
      // (where the app uses BITGET_API_SECRET, not the server's BITGET_SECRET_KEY).
      // So strip all three server-named creds, then add them back only when we
      // have the complete set — otherwise run in public read-only mode.
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      delete childEnv.BITGET_API_KEY;
      delete childEnv.BITGET_SECRET_KEY;
      delete childEnv.BITGET_PASSPHRASE;
      if (this.opts.apiKey && this.opts.secretKey && this.opts.passphrase) {
        childEnv.BITGET_API_KEY = this.opts.apiKey;
        childEnv.BITGET_SECRET_KEY = this.opts.secretKey;
        childEnv.BITGET_PASSPHRASE = this.opts.passphrase;
      }
      const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"], env: childEnv });
      this.proc = proc;

      proc.on("error", (err: Error) => reject(new BitgetMcpError(`failed to spawn ${bin}: ${err.message}`)));
      proc.on("exit", (code: number | null) => {
        const err = new BitgetMcpError(`bitget-mcp-server exited (code ${code ?? "?"})`);
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(err);
        }
        this.pending.clear();
      });
      proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk.toString()));

      // initialize → initialized notification → resolve when init replies.
      this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "wardenclaw", version: "0.1.0" },
      })
        .then(() => {
          this.notify("notifications/initialized");
          resolve();
        })
        .catch(reject);
    });
    return this.starting;
  }

  private onData(text: string): void {
    this.buf += text;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue; // ignore non-JSON log lines on stdout
      }
      if (typeof msg.id !== "number") continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new BitgetMcpError(`MCP error ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  }

  private send(obj: Record<string, unknown>): void {
    if (!this.proc?.stdin) throw new BitgetMcpError("client not started");
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BitgetMcpError(`MCP request '${method}' timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    });
  }

  /** List the tools the server exposes (verified surface introspection). */
  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    await this.start();
    const res = (await this.request("tools/list")) as { tools?: Array<{ name: string; description?: string }> };
    return res.tools ?? [];
  }

  /**
   * Call a Bitget tool and return its parsed JSON payload. MCP tool results carry
   * a `content` array of text parts; Bitget returns JSON text, which we parse.
   */
  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    await this.start();
    const res = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = res.content?.find((c) => c.type === "text")?.text ?? "";
    if (res.isError) throw new BitgetMcpError(`tool '${name}' returned an error: ${text.slice(0, 200)}`);
    if (!text) throw new BitgetMcpError(`tool '${name}' returned no content`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new BitgetMcpError(`tool '${name}' returned non-JSON content: ${text.slice(0, 120)}`);
    }
  }

  async stop(): Promise<void> {
    this.proc?.kill();
    this.proc = undefined;
    this.starting = undefined;
  }
}
