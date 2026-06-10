# Special Prizes — Evidence Mapped to the Verified Rubrics

Three $2,000 special prizes, stackable with main placements. WARDENCLAW BSC is
engineered against each.

## Best Use of Trust Wallet Agent Kit (§0.1c rubric, by point band)

| Rubric line (pts) | How WARDENCLAW maxes it | Evidence |
|---|---|---|
| **Integration depth (30)** — sole executor, more than one surface | TWAK is the only signer and uses **three** surfaces: local signing, autonomous mode, and native x402. The strategy/risk logic is upstream; TWAK is structurally irreplaceable. | `packages/twak-adapter/*`, `PolicyEnforcingExecutor`, `payX402InLoop`, registration |
| **Self-custody integrity (20–25)** — clean local signing, zero custodial components | The backend produces Signal Mandates only and **cannot move funds**; no DB-stored keys; the key stays local with TWAK. | `apps/api` (no signer), `apps/worker` (no signer), `docs/SAFETY.md` |
| **Autonomous execution + guardrails (20)** — hands-off, builder-set rules | Drawdown caps, address-keyed allowlists, per-trade & daily limits, slippage protection — all enforced at the signer. Plus net-edge, stop coherence, shadow-fill, gas reserve, loss-streak cooldown, survival mode, no infinite approvals, allowlisted router/spender. | `evaluateTwakPolicy`, `evaluateRiskGates`, `test/policy.test.ts` |
| **Native x402 (10)** — pays per request in the trade loop | x402 pays for the CMC request used in the decision; the receipt is chained into the mandate (`x402 request → paid → used → mandate`). | `payX402InLoop`, `X402Receipt`, proof anchors |
| **Originality & relevance (10)** — an agent a self-custody user would run unattended | A disciplined $40 spot trader with a survival constitution and a kill-switch reachable from a phone. | `/bsc/ops`, `KillSwitch` |
| **Demo & presentation (5)** — loop end-to-end with on-chain proof | The demo walks perception → gates → TWAK refusal → real swap → BSC tx on `/bsc/proof`. | `scripts/demo-twak-refusal.ts`, `/bsc/proof` |

**The refusal beat (§5.4a):** `pnpm demo:twak-refusal` presents a clean swap
(approved) then refuses non-spot, wrong-chain, unknown-spender, off-list,
WBNB-held, infinite-approval, over-cap, and action-mismatch intents — each at the
policy layer, before any signing. This is the strongest single piece of evidence
for the integration-depth and guardrails lines. Tie-breakers (cleanest
self-custody → deepest least-replaceable TWAK → most substantive x402) all favor
this design.

## Best Use of Agent Hub (CMC)

- **MCP / tools:** real quotes, trending (feeds the catalyst family), and Fear &
  Greed via the CMC Pro API surface; the design extends to DEX pairs, news/social,
  and pre-computed indicators.
- **Contract resolution:** the eligible list is resolved symbol→BEP-20 contract
  via CMC (`build:eligible-tokens`) — a concrete, judgeable Agent Hub use.
- **x402:** pay-per-request inside the trade loop with receipts.
- **Per-mandate attribution:** every mandate records exactly which CMC tools fed
  it (`perception.cmcToolsUsed`), shown on `/bsc/mandates/:id` and `/bsc/proof`.

Evidence: `packages/cmc-adapter/*`, `buildMomentumInputs`/`buildCatalystInputs`,
`scripts/build-eligible-tokens.ts`.

## Best Use of BNB AI Agent SDK

- Orchestration graph: ConstitutionCompiler → CMCSignal → TradeScoring → RiskGuard
  → TWAKExecution → Watchdog → SettlementAudit. The SDK coordinates tasks; it never
  replaces TWAK execution or duplicates strategy/scoring/risk logic.
- If the official SDK is Python-only, a narrow sidecar would own zero strategy
  logic; the TypeScript core stays the single source of truth.

## LLM & x402 policy statements

- **LLM proposes, deterministic engine decides, Risk Constitution vetoes, TWAK
  executes only approved eligible-contract spot mandates.** There is no
  LLM-direct live-execution path (`packages/core/src/llm`, `docs/LLM_POLICY.md`).
- **x402:** preferred path pays the CMC request used in the decision through TWAK;
  fallback is the official CMC x402 client. Every request logs url/amount/asset/
  payer/recipient/receipt/usedInDecision. No README-only claims.
