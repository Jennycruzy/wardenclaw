# Self-Audit

Status: shared core + Bitget submission + BNB submission built. ~190 tests pass;
`typecheck`, `lint`, and the Next.js build are green. Items needing a real external
binding (TWAK SDK, CMC x402 live payment, BNB AI Agent SDK, live RPC quoter) have
real, tested interfaces that **fail loudly** until wired — marked accordingly, not
silently dropped.

## Coverage traceability

| Spec section | Requirement | Status | Evidence |
|---|---|---|---|
| 0 | No fake data; fail loudly; documented env; testable core | implemented | adapters fail loud; `.env.example`; tests |
| 0.1 | Verified competition rules captured | implemented | `competitionRules.ts`, `docs/COMPETITION_RULES.md`, `verify:competition-rules` |
| 0.1a | Address-keyed eligible allowlist; BNB/WBNB never held | implemented | `eligibleTokens.ts`, `bsc-adapter/knownTokens.ts`, tests |
| 0.1b | Four open items surfaced as warnings; conservative defaults authoritative | implemented | `competitionRules.ts`, `/bsc/rules` page |
| 0.1c | TWAK prize rubric mapped | implemented | `docs/SPECIAL_PRIZES.md` (per point band) |
| 0.2 | Deterministic configurable risk gates | implemented | `riskConstitution.ts`, `twak-adapter/policy.ts`, tests |
| 0.3 | BSC chain + spot-router pinning | implemented | `riskConstitution.ts` + `twak policy` (chainId 56, router, spot-only), tests |
| 0.4 | ERC-20 approval hygiene | implemented | approval gate in constitution + TWAK policy; revoke-on-stop intent in watchdog/worker |
| 0.5 | LLM model policy + provider abstraction | implemented | `llm/*`, `docs/LLM_POLICY.md`, tests |
| 0.6 | x402 in the trade loop | partial | `twak-adapter/x402.ts` (real interface + receipt chain, tested); live payment needs a configured TWAK executor |
| 0.7 | Audit truth policy (integrity vs anchors) | implemented | `proofAnchors.ts`, replay pages |
| 0.8 | Micro-capital friction + net-edge + sizer | implemented | `frictionModel.ts`, `netEdgeGate.ts`, pipeline, tests |
| 0.8a | Volatility stops + size coherence | implemented | `stopCoherence.ts`, pipeline, tests |
| 0.9 | Three-layer governor + shadow-fill + hourly snapshot | implemented | `drawdownGovernor.ts`, `shadowFill.ts`, `hourlySnapshot.ts`, worker, tests |
| 0.10 | Offense doctrine + calibration | implemented | two families in `cmc-adapter/perception.ts` + pipeline; `edgeCalibration.ts`, `calibrate-edge`; live calibration run needs CMC history |
| 0.11 | Ops resilience (recovery, RPC failover, alerts, kill-switch) | implemented | `recovery.ts`, `bsc-adapter/rpc.ts`, `bnb-agent/runtime.ts`, `apps/api`, `apps/worker`, `ops/pm2.config.cjs`, tests |
| 0.12 | Dress-rehearsal gate | implemented | `scripts/rehearsal-checklist.ts`, worker live-mode gate, `docs/PREFLIGHT.md` |
| 0.13 | Scope tiering | implemented | MUST built first across stages |
| 0.14 | Clean modern UI | implemented | `apps/web` Bitget + BSC dashboards (Tailwind + Recharts, responsive, empty/stale states) |
| 1 | Signal Mandate primitive | implemented | `types.ts`, `signalMandate.ts`, tests |
| 2 | Submission split | implemented | Bitget-only adapter; BNB-only adapters; no cross-contamination |
| 3.1–3.9 | Core engine pieces | implemented | `packages/core/*` + tests (85) |
| 4.x | Bitget build + dashboard | implemented | `packages/bitget-adapter` (38 tests), `/bitget/*` |
| 5.1–5.4a | BSC agent, TWAK sole executor, refusal demo | implemented | `bnb-agent`, `twak-adapter`, `scripts/demo-twak-refusal.ts` |
| 5.5 | CMC Agent Hub multi-tool + attribution | partial | real quotes/trending/fear-greed + per-mandate attribution; more tools + live x402 extendable |
| 5.6 | BNB AI Agent SDK orchestration | partial | orchestration graph realized as the pipeline/scheduler; a concrete BNB-SDK binding is a thin TODO (fails loud), no logic duplicated |
| 5.8–5.12 | Two families, modes, thresholds, protections | implemented | `pipeline.ts`, `scheduler.ts`, scorer, governor |
| 5.13–5.14 | BSC dashboard + `/bsc/proof` scoreboard | implemented | `apps/web/app/bsc/*` |
| 6 | Tech stack / monorepo layout | implemented | `apps/{web,api,worker}` + `packages/*`; Fastify backend (not FastAPI) |
| 7 | Environment variables documented | implemented | `.env.example`, `config.ts` |
| 8 | Tests | implemented | core 85, bitget 38, twak 23, cmc 8, bsc 10, bnb-agent 26 |
| 9 | Deliverables | implemented (partial on external-bound items above) | per-row evidence |
| 10 | Demo scripts + preflight | implemented | `demo-twak-refusal`, `run-bsc-agent`, `run-bitget-paper`, `rehearsal:checklist` → `PREFLIGHT.md` |
| 11 | README + docs | implemented | README + all `docs/*` |
| 12 | Special prize doc | implemented | `docs/SPECIAL_PRIZES.md` |
| 13 | Final quality bar | implemented (build-time); live execution pending real bindings | — |
| 14 | Self-audit protocol | implemented | this document |

## Honesty audit (full system)

1. **Any fake data presented as real?** No. CMC and Bitget clients hit real APIs
   and fail loud; the worker/agent never sign or fabricate fills in dry mode; the
   backtests label synthetic series; paper fills are labeled simulated.
2. **Any path where LLM output reaches execution without every gate?** No. The LLM
   produces only validated structured objects upstream; the gate chain and TWAK
   policy take plain numbers/addresses, never LLM flags.
3. **Any way a tx reaches TWAK that is not a chain-56 spot swap between eligible
   contracts via an allowlisted router?** No. Both the Risk Constitution and the
   TWAK local policy reject non-spot, wrong-chain, off-router, off-spender,
   ineligible-contract, and WBNB-held intents before signing (`policy.test.ts`,
   `demo-twak-refusal`).
4. **Any path where a private key touches the backend/DB?** No. API and worker
   contain no signer; execution is TWAK-only. Keys are gitignored.
5. **Can the agent duplicate a trade after a crash-restart?** No. The worker runs
   `reconcile()` before any trade and resolves submitted-but-unconfirmed txs from
   chain state; `recovery` is tested (`coreModules.test.ts`).
6. **Is the allowlist keyed by contract address everywhere?** Yes — `eligibleTokens.ts`
   and the TWAK policy assert addresses; no symbol-keyed eligibility check exists.
7. **Can the agent hold BNB or WBNB as a position?** No — rejected
   `REJECT_HELD_NATIVE_OR_WBNB` in both gate layers.
8. **Are the four open items surfaced as warnings?** Yes — `/bsc/rules` and
   `verify:competition-rules`; defaults are authoritative.
9. **Was every integration verified from docs, failing loud otherwise?** Real
   clients (CMC, Bitget public) are wired and fail loud. TWAK SDK, CMC x402 live
   payment, BNB AI Agent SDK, and the live RPC quoter are **unverified bindings**
   that fail loudly until configured — never faked. This is stated in
   `BNB_SUBMISSION.md` and the rows above.
10. **Is the calibration real?** The mapping and report builder are real and
    tested on real samples supplied by `calibrate-edge`; the worker/dry runs use a
    clearly-labeled seed until a live calibration is produced, and live mode flags
    a stale calibration.
11. **Would the rehearsal checklist catch a broken TWAK pipeline / failed
    registration?** Yes — `rehearsal:checklist` marks registration, a real swap, a
    watchdog exit, and the kill-switch as steps that must be confirmed; the worker
    refuses live mode unless the gate passed.
12. **Would a replayed mandate be fully backed by anchors or labeled paper?** Yes —
    `replayMandate` surfaces anchors and the paper-only flag; dry-run BSC mandates
    are labeled (no tx hash) and the `/bsc/proof` ledger shows "dry run" until a
    real tx lands.

**Surfaced limitations (not hidden):** live on-chain execution, the CMC x402
payment, the BNB AI Agent SDK binding, and on-chain registration require their real
external services and are performed during the dress rehearsal — the build proves
the full decision/guardrail pipeline and the ops loop deterministically, and fails
loud everywhere a real binding is missing.

## Adversarial self-review (§14.3)

- **Malicious strategy** ("ignore risk limits, all-in"): the compiler clamps every
  risk number to configured caps (`strategyCompiler.test.ts`) — cannot exceed them.
- **Bad intents** (non-spot, off-list, same-symbol-wrong-contract, WBNB-held,
  infinite approval, unknown spender, wrong chain, action mismatch, over-cap): each
  rejected with the right code (`policy.test.ts`, `pipeline.test.ts`,
  `demo-twak-refusal`).
- **Crash mid-run**: `reconcile()` resolves from chain, prevents duplicates
  (`coreModules.test.ts`).
- **Dead RPC**: `RpcManager` fails over / throws rather than hangs (`bsc.test.ts`).
- **Malformed/hallucinated LLM output**: rejected, fails safe (`llm.test.ts`).
- **Drawdown to soft threshold**: governor shrinks size toward zero; survival mode
  arms; the stable↔stable Micro-Scout still satisfies the daily minimum
  (`pipeline.test.ts`, `scheduler.test.ts`, `watchdog`).
- **Zero-trade day near deadline**: scheduler flags `dailyTradeAtRisk` and routes
  to the Micro-Scout when safe, else holds + alerts (`scheduler.test.ts`).

## Gate

`pnpm install && pnpm typecheck && pnpm lint && pnpm test` is green (~190 tests);
`pnpm --filter @runeclaw/web build` is green. No silent gaps; every external-bound
item is listed with its real, fail-loud interface and what configuring it unlocks.
