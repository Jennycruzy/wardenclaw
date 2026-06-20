/** Known-asset gate: unknown/unverified asset → BLOCK (fail-closed). */
import { type GateResult, type MarketContext, hit, ok } from "./shared.js";

export function gateKnownAsset(ctx: MarketContext): GateResult {
  if (!ctx.knownAsset) return hit("known_asset", "block", false, true, "unknown asset — fail-closed");
  return ok("known_asset", true, true, "asset in verified universe");
}
