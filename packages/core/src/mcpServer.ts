/**
 * WardenClaw MCP tool surface — exposes the firewall itself as MCP tools so any
 * Claude/Cursor agent must route trade intent through it. The tool LOGIC lives
 * here (pure, testable); the stdio JSON-RPC transport is a thin wrapper in
 * scripts/warden-mcp-server.ts.
 *
 * Tools: audit_strategy, request_permit, verify_permit, get_card, replay_card,
 * get_closeonly_status, run_ghost_sim. The deterministic engine produces every
 * verdict — the agent calling these tools never gets to make a risk decision.
 */

import { auditStrategy } from "./playbookShield.js";
import {
  evaluateTradePermit,
  type TradeIntent,
  type MarketContext,
} from "./tradePermit.js";
import {
  issuePermit,
  validatePermitForExecution,
  verdictIssuesPermit,
  PermitStore,
  type WardenPermit,
} from "./wardenPermit.js";
import { CloseOnlyController } from "./closeOnlyWatcher.js";
import { ghostCompare, type SimOrder, type SimCandle } from "./ghostSim.js";
import { verifyCard } from "./wardenCard.js";

export interface WardenMcpContext {
  store: PermitStore;
  closeOnly: CloseOnlyController;
  signingKey?: string;
  /** Monotonic permit sequence. */
  seq: { value: number };
}

export function createWardenMcpContext(signingKey?: string): WardenMcpContext {
  return {
    store: new PermitStore(),
    closeOnly: new CloseOnlyController(undefined, signingKey),
    ...(signingKey ? { signingKey } : {}),
    seq: { value: 0 },
  };
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const WARDEN_MCP_TOOLS: McpToolDef[] = [
  { name: "audit_strategy", description: "Playbook Shield: audit a natural-language strategy. Returns the strategy verdict (Certified/Restricted/Rejected), failed checks, Warden-adjusted caps, and a signed Strategy Safety Card.",
    inputSchema: { type: "object", properties: { strategy: { type: "string" } }, required: ["strategy"] } },
  { name: "request_permit", description: "Trade-Permit Engine: evaluate a structured trade intent against the ten gates. Returns the verdict (APPROVE/REDUCE/DELAY/HEDGE/BLOCK/CLOSE_ONLY) and, for non-BLOCK, a signed Warden Permit.",
    inputSchema: { type: "object", properties: { intent: { type: "object" }, market: { type: "object" } }, required: ["intent", "market"] } },
  { name: "verify_permit", description: "Independently verify a permit by id or full JSON: signature, expiry, single-use, price-drift, action match.",
    inputSchema: { type: "object", properties: { permit_id: { type: "string" }, permit: { type: "object" }, currentPrice: { type: "number" }, requestedAction: { type: "string" }, nowIso: { type: "string" } } } },
  { name: "get_card", description: "Fetch a stored Warden Permit by id.", inputSchema: { type: "object", properties: { permit_id: { type: "string" } }, required: ["permit_id"] } },
  { name: "replay_card", description: "Replay a stored permit and re-verify its signature/hash.", inputSchema: { type: "object", properties: { permit_id: { type: "string" } }, required: ["permit_id"] } },
  { name: "get_closeonly_status", description: "Whether the account is in CLOSE-ONLY survival mode.", inputSchema: { type: "object", properties: {} } },
  { name: "run_ghost_sim", description: "Compute the counterfactual of an original order vs a Warden-adjusted order over a candle path.",
    inputSchema: { type: "object", properties: { original: { type: "object" }, adjusted: { type: "object" }, candles: { type: "array" } }, required: ["original", "adjusted", "candles"] } },
];

export interface McpToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Dispatch a tool call against the engine. Pure over the provided context. */
export function callWardenTool(name: string, args: Record<string, unknown>, ctx: WardenMcpContext): McpToolResult {
  try {
    switch (name) {
      case "audit_strategy": {
        const r = auditStrategy({
          strategy: String(args.strategy ?? ""),
          ...(ctx.signingKey ? { signingKey: ctx.signingKey } : {}),
        });
        return { ok: true, data: { verdict: r.verdict, mayEmitMandates: r.mayEmitMandates, failedChecks: r.failedChecks, caps: r.caps, card: r.card } };
      }
      case "request_permit": {
        const intent = args.intent as TradeIntent;
        const market = args.market as MarketContext;
        const evaluation = evaluateTradePermit(intent, market);
        if (!verdictIssuesPermit(evaluation.verdict)) {
          return { ok: true, data: { verdict: evaluation.verdict, permit: null, gatesFailed: evaluation.gatesFailed } };
        }
        const permit = issuePermit({
          evaluation, intent, priceAtIssue: market.price, nowIso: market.nowIso, seq: ++ctx.seq.value,
          ...(ctx.signingKey ? { signingKey: ctx.signingKey } : {}),
        });
        ctx.store.register(permit);
        return { ok: true, data: { verdict: evaluation.verdict, permit, gatesFailed: evaluation.gatesFailed } };
      }
      case "verify_permit": {
        const permit = (args.permit as WardenPermit) ?? (args.permit_id ? ctx.store.get(String(args.permit_id)) : undefined);
        if (!permit) return { ok: false, error: "permit not found" };
        if (args.currentPrice !== undefined && args.requestedAction) {
          const v = validatePermitForExecution({
            permit, store: ctx.store, currentPrice: Number(args.currentPrice),
            nowIso: String(args.nowIso ?? permit.created_at), requestedAction: args.requestedAction as TradeIntent["direction"],
            ...(ctx.signingKey ? { signingKey: ctx.signingKey } : {}),
          });
          return { ok: true, data: v };
        }
        const v = verifyCard(permit, ctx.signingKey ? { signingKey: ctx.signingKey } : {});
        return { ok: true, data: v };
      }
      case "get_card": {
        const permit = ctx.store.get(String(args.permit_id));
        return permit ? { ok: true, data: permit } : { ok: false, error: "permit not found" };
      }
      case "replay_card": {
        const permit = ctx.store.get(String(args.permit_id));
        if (!permit) return { ok: false, error: "permit not found" };
        const v = verifyCard(permit, ctx.signingKey ? { signingKey: ctx.signingKey } : {});
        return { ok: true, data: { permit, verification: v, consumed: ctx.store.isConsumed(permit.permit_id) } };
      }
      case "get_closeonly_status": {
        return { ok: true, data: { active: ctx.closeOnly.isActive } };
      }
      case "run_ghost_sim": {
        const cmp = ghostCompare(args.original as SimOrder, args.adjusted as SimOrder, args.candles as SimCandle[]);
        return { ok: true, data: cmp };
      }
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
