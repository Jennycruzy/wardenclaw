/**
 * Competition registration through TWAK.
 *
 * Registration is performed by TWAK's verified `twak compete register` CLI or the
 * `competition_register` MCP action, which resolve the agent wallet and submit the
 * registration transaction to the competition contract. This module builds the
 * registration request and validates the target; it never fabricates a tx hash —
 * a real registration requires a configured TWAK executor.
 */

import { COMPETITION } from "@runeclaw/core";
import type { RegistrationResult } from "./types.js";
import type { TwakExecutor } from "./executor.js";

export interface RegistrationRequest {
  contractAddress: string;
  method: "twak_cli" | "mcp_action";
}

/** Build the registration request against the verified competition contract. */
export function buildRegistrationRequest(
  method: RegistrationRequest["method"] = "twak_cli",
): RegistrationRequest {
  return { contractAddress: COMPETITION.contractAddress, method };
}

/** Whether the window is still open for registration (closes when trading opens). */
export function registrationOpen(nowMs: number): boolean {
  return nowMs < Date.parse(COMPETITION.tradingWindow.startUtc);
}

/**
 * Register through a real TWAK executor. Refuses if the registration window has
 * closed (the contract rejects late entries) or the executor is unconfigured.
 */
export async function registerForCompetition(
  executor: TwakExecutor,
  nowMs: number,
): Promise<RegistrationResult> {
  if (!registrationOpen(nowMs)) {
    return {
      registered: false,
      contractAddress: COMPETITION.contractAddress,
      agentWallet: "",
      detail: "registration window closed — the competition contract rejects late entries",
    };
  }
  // The real executor resolves the wallet and submits the on-chain registration.
  return executor.registerForCompetition(COMPETITION.contractAddress);
}
