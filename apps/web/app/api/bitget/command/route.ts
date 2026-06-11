/**
 * Queue a command for the running interactive console (paper trading only).
 * Commands are whitelisted verbs, appended to data/runtime/bitget-commands.jsonl;
 * the console executes them within a second and the result shows up in the live
 * event feed. Optionally gated by DASHBOARD_COMMAND_TOKEN.
 */
import { NextResponse } from "next/server";
import { queueBitgetCommand } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { command?: string; token?: string };
  try {
    body = (await req.json()) as { command?: string; token?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const required = process.env.DASHBOARD_COMMAND_TOKEN;
  if (required && body.token !== required) {
    return NextResponse.json({ error: "invalid token" }, { status: 403 });
  }
  if (!body.command || typeof body.command !== "string") {
    return NextResponse.json({ error: "missing command" }, { status: 400 });
  }
  const result = queueBitgetCommand(body.command);
  if ("error" in result) {
    return NextResponse.json(result, { status: 422 });
  }
  return NextResponse.json({ queued: true, id: result.id });
}
