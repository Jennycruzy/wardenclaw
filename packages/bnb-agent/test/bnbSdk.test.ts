import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentIdentity, BnbSdkError } from "../src/index.js";

let dir: string;
let okStub: string;
let failStub: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bnb-sdk-"));
  okStub = join(dir, "ok.sh");
  failStub = join(dir, "fail.sh");
  writeFileSync(okStub, `#!/bin/sh\necho '{"ok":true,"agentId":"42","transactionHash":"0xBNBID","network":"bsc-testnet"}'\n`);
  writeFileSync(failStub, `#!/bin/sh\necho '{"ok":false,"error":"bnbagent is not installed"}'\nexit 1\n`);
  chmodSync(okStub, 0o755);
  chmodSync(failStub, 0o755);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("registerAgentIdentity (BNB AI Agent SDK bridge)", () => {
  it("parses a successful registration from the sidecar", async () => {
    const r = await registerAgentIdentity({ scriptPath: "ignored", python: okStub });
    expect(r.ok).toBe(true);
    expect(r.agentId).toBe("42");
    expect(r.transactionHash).toBe("0xBNBID");
  });

  it("fails loud when the sidecar reports an error", async () => {
    await expect(registerAgentIdentity({ scriptPath: "ignored", python: failStub })).rejects.toBeInstanceOf(BnbSdkError);
  });

  it("fails loud when python is missing", async () => {
    await expect(
      registerAgentIdentity({ scriptPath: "x", python: "definitely-not-python-xyz" }),
    ).rejects.toThrow(/not found|failed/);
  });
});
