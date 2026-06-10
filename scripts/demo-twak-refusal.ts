/**
 * TWAK "refuses a bad trade" demo (§5.4a).
 *
 * Presents a clean spot swap (approved) and a battery of deliberately
 * non-compliant intents (non-spot, wrong chain, unknown spender, off-list token,
 * holding WBNB, infinite approval, over-cap amount, action mismatch). TWAK's local
 * policy REFUSES each before any signing — proving the self-custody guardrail.
 * No funds move. Each outcome is written as a hash-chained audit event.
 *
 *   pnpm demo:twak-refusal
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AuditLogger, EligibleAllowlist } from "@wardenclaw/core";
import {
  PolicyEnforcingExecutor,
  UnconfiguredTwakExecutor,
  type TwakIntent,
  type TwakPolicyConfig,
} from "@wardenclaw/twak-adapter";
import { STARTER_TOKENS, PANCAKE_V2_ROUTER } from "@wardenclaw/bsc-adapter";

const USDT = STARTER_TOKENS.find((t) => t.symbol === "USDT")!.bscContractAddress;
const CAKE = STARTER_TOKENS.find((t) => t.symbol === "CAKE")!.bscContractAddress;
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const OFFLIST = "0x1111111111111111111111111111111111111111";

const allowlist = new EligibleAllowlist(STARTER_TOKENS);
const policy: TwakPolicyConfig = {
  requiredChainId: 56,
  allowedRouters: ["pancakeswap"],
  allowedSpenders: [PANCAKE_V2_ROUTER],
  allowedContracts: [PANCAKE_V2_ROUTER],
  maxTradeUsd: 30,
  maxDailySpendUsd: 20,
  maxSlippageBps: 50,
  allowInfiniteApprovals: false,
  approvalBufferBps: 50,
};

function intent(overrides: Partial<TwakIntent> = {}): TwakIntent {
  return {
    kind: "swap",
    chainId: 56,
    executionType: "spot_only",
    router: "pancakeswap",
    spender: PANCAKE_V2_ROUTER,
    to: PANCAKE_V2_ROUTER,
    tokenInAddress: USDT,
    tokenOutAddress: CAKE,
    amountInUsd: 15,
    txValueWei: "0",
    isInfiniteApproval: false,
    approvalAmount: 15,
    mandateAmount: 15,
    slippageBps: 30,
    isNonSpot: false,
    decodedAction: "enter_long",
    mandateAction: "enter_long",
    ...overrides,
  };
}

const cases: Array<[string, TwakIntent]> = [
  ["clean spot swap (APPROVED)", intent()],
  ["non-spot / perp route", intent({ isNonSpot: true })],
  ["wrong chain (Ethereum)", intent({ chainId: 1 })],
  ["unknown spender", intent({ spender: OFFLIST })],
  ["off-list token out", intent({ tokenOutAddress: OFFLIST })],
  ["holding WBNB as a position", intent({ tokenOutAddress: WBNB })],
  ["infinite approval", intent({ isInfiniteApproval: true })],
  ["over per-trade cap", intent({ amountInUsd: 100 })],
  ["decoded action != mandate", intent({ decodedAction: "exit", mandateAction: "enter_long" })],
];

async function main(): Promise<void> {
  // The inner executor is unconfigured — it would throw if ever asked to sign.
  // The policy refuses bad intents BEFORE that, so signing is never reached.
  const executor = new PolicyEnforcingExecutor(new UnconfiguredTwakExecutor(), allowlist, policy);

  const auditDir = join(process.cwd(), "data", "audit");
  mkdirSync(auditDir, { recursive: true });
  const audit = new AuditLogger(join(auditDir, `twak-refusal-demo-${Date.now()}.jsonl`));

  console.log("\n  TWAK local policy — refusal demo (no funds move)\n");
  for (const [name, twakIntent] of cases) {
    const result = executor.check(twakIntent);
    const tag = result.approved ? "✓ APPROVE" : "✗ REFUSE ";
    const detail = result.approved ? "safe to sign" : `${result.rejectCode} — ${result.reason}`;
    console.log(`  ${tag}  ${name.padEnd(34)} ${detail}`);
    await audit.append({
      timestamp: new Date().toISOString(),
      mandateId: `demo-${name.replace(/[^a-z0-9]+/gi, "-")}`,
      stage: "risk",
      input: { intent: twakIntent },
      output: {
        approved: result.approved,
        ...(result.rejectCode ? { rejectCode: result.rejectCode } : {}),
        reason: result.reason,
      },
    });
  }
  console.log("\n  Every refusal happened at the policy layer, before any signing.\n");
}

main().catch((err) => {
  console.error("demo-twak-refusal failed:", err);
  process.exitCode = 1;
});
