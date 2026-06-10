/**
 * Bridge to the BNB AI Agent SDK Python sidecar (`apps/bnb-sdk-sidecar`). The SDK
 * is Python; this shells out to it and parses its JSON. It carries NO strategy
 * logic — it only triggers on-chain agent-identity registration (ERC-8004) and
 * returns the result. Fails loud if python3 or the package is missing.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface AgentIdentityResult {
  ok: boolean;
  agentId?: string;
  transactionHash?: string;
  network?: string;
  error?: string;
}

export interface RegisterAgentOptions {
  /** Path to the sidecar script. */
  scriptPath: string;
  /** Python interpreter (default python3). */
  python?: string;
  /** Extra environment for the sidecar (wallet password, network, etc.). */
  env?: Record<string, string>;
}

export class BnbSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BnbSdkError";
  }
}

/** Register the agent identity on-chain via the bnbagent sidecar. */
export async function registerAgentIdentity(opts: RegisterAgentOptions): Promise<AgentIdentityResult> {
  const python = opts.python ?? process.env.PYTHON_BIN ?? "python3";
  try {
    const { stdout } = await run(python, [opts.scriptPath], {
      env: { ...process.env, ...opts.env },
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const text = stdout.trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new BnbSdkError(`sidecar produced no JSON: ${text.slice(0, 200)}`);
    }
    const result = JSON.parse(text.slice(start, end + 1)) as AgentIdentityResult;
    if (!result.ok) throw new BnbSdkError(result.error ?? "agent registration failed");
    return result;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new BnbSdkError(
        "python3 not found. Install Python and the sidecar deps (apps/bnb-sdk-sidecar/requirements.txt).",
      );
    }
    if (err instanceof BnbSdkError) throw err;
    throw new BnbSdkError(`bnbagent sidecar failed: ${e.message}`);
  }
}
