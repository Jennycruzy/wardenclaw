/**
 * Live console state for the dashboard. Reads the JSON the interactive console
 * publishes each cycle (data/runtime/bitget-live.json). When the console is not
 * running the dashboard shows an honest offline state — never a fabricated one.
 */
import { NextResponse } from "next/server";
import { loadBitgetLive } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = loadBitgetLive();
  return NextResponse.json(state ?? { running: false, updatedAt: null });
}
