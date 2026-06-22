/**
 * "Break the Warden" arena API. Two POST actions, both pure over the existing
 * firewall engine (no new trading logic, paper/sim only):
 *
 *   { action: "evaluate", command }      → parse → live MarketContext → Playbook
 *                                          Shield + ten gates + Warden Permit +
 *                                          counterfactual finale.
 *   { action: "attack", permit, attack } → run one tamper attempt through the
 *                                          executor's independent verifier.
 *
 * The engine produces every verdict; this route only wires inputs to outputs.
 */
import { NextResponse } from "next/server";
import {
  evaluateArena,
  attackPermit,
  type ArenaAttack,
} from "@/lib/arena";
import type { WardenPermit } from "@wardenclaw/core";

export const dynamic = "force-dynamic";

const ATTACKS = new Set<ArenaAttack>(["intact", "strip", "edit", "expire", "drift", "replay"]);

export async function POST(req: Request) {
  let body: { action?: string; command?: string; permit?: WardenPermit; attack?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.action === "evaluate") {
    const command = typeof body.command === "string" ? body.command.trim() : "";
    if (!command) return NextResponse.json({ error: "missing command" }, { status: 400 });
    if (command.length > 200) return NextResponse.json({ error: "command too long" }, { status: 422 });
    try {
      return NextResponse.json(await evaluateArena(command));
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  if (body.action === "attack") {
    const attack = body.attack as ArenaAttack;
    if (!ATTACKS.has(attack)) {
      return NextResponse.json({ error: `unknown attack "${body.attack}"` }, { status: 422 });
    }
    if (!body.permit || typeof body.permit !== "object" || !body.permit.permit_id) {
      return NextResponse.json({ error: "missing permit" }, { status: 422 });
    }
    try {
      return NextResponse.json(attackPermit({ permit: body.permit, attack }));
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
