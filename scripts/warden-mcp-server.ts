/**
 * WardenClaw MCP server — stdio JSON-RPC transport exposing the firewall as MCP
 * tools (audit_strategy, request_permit, verify_permit, get_card, replay_card,
 * get_closeonly_status, run_ghost_sim). Any Claude/Cursor agent can register it
 * and must route trade intent through it. Newline-delimited JSON-RPC, matching the
 * repo's existing MCP client transport — no SDK dependency.
 *
 * Register (alongside the Bitget MCP server):
 *   claude mcp add -s user wardenclaw -- npx tsx scripts/warden-mcp-server.ts
 *
 *   pnpm mcp:wardenclaw
 */

import { createInterface } from "node:readline";
import {
  WARDEN_MCP_TOOLS,
  callWardenTool,
  createWardenMcpContext,
} from "@wardenclaw/core";

const ctx = createWardenMcpContext(process.env.WARDEN_SIGNING_KEY);

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handle(req: { id?: unknown; method?: string; params?: Record<string, unknown> }): void {
  const { id, method, params } = req;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "wardenclaw", version: "0.1.0" },
    } });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: WARDEN_MCP_TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const name = String(params?.name ?? "");
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    const result = callWardenTool(name, args, ctx);
    send({ jsonrpc: "2.0", id, result: {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.ok,
    } });
    return;
  }
  if (method === "notifications/initialized" || id === undefined) return;
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handle(JSON.parse(trimmed));
  } catch (err) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `parse error: ${(err as Error).message}` } });
  }
});
