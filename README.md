# WARDENCLAW — Command Firewall for Bitget xStocks

> A **two-checkpoint command firewall** for Bitget tokenized US stocks (xStocks).
> It audits the **strategy** before it may run, then audits **each trade command**
> before execution, and proves — cryptographically — why it acted.
>
> **No valid Warden Permit = no execution.**
> And one step earlier: **no unsafe strategy even produces mandates.**

Everything is **paper / simulation only**. The LLM parses natural language and
classifies news; **every risk verdict is deterministic**. The system is fail-closed:
stale data, a tampered/expired/replayed permit, or an unknown asset → it refuses.

## The two checkpoints

```
Bitget Playbook / human / AI strategy
        │
        ▼
[1] PLAYBOOK SHIELD ── audits the STRATEGY            Certified / Restricted / Rejected
        │   (Restricted hands tightened caps to the compiler clamp)
        ▼
Risk-bound Signal Mandates  (only a passing strategy emits them, under its clamped caps)
        │
        ▼
[2] TRADE-PERMIT ENGINE ── audits each TRADE command  APPROVE / REDUCE / DELAY / HEDGE / BLOCK / CLOSE-ONLY
        │
        ▼
Sim Executor (paper only) ── independently verifies the signed permit; no valid permit = no execution
        │
        ▼
Signed, hash-chained, replayable Warden Card  +  native terminal evidence
```

- **Playbook Shield** — three strategy verdicts over five deterministic static checks
  (leverage, martingale, missing daily-drawdown cap, missing post-shock cooldown,
  earnings/first-spike without confirmation). See `docs/PLAYBOOK_SHIELD.md`.
- **Trade-Permit Engine** — six trade verdicts over ten deterministic gates, including
  the asset-class-native **xStock premium/discount** gate and the BTC-correlation
  HEDGE gate. See `docs/GATE_TABLE.md`.
- **Warden Permit** — every non-BLOCK verdict produces a signed (HMAC-SHA256),
  single-use, expiring, price-drift-bound, hash-chained permit. The executor verifies
  it independently before any (paper) order.

## Verified universe (live-reconciled)

Exactly five tradeable xStocks, reconciled against the live Bitget symbols API
(`docs/ARCHITECTURE_AUDIT.md`): `AAPLx`, `NVDAx`, `TSLAx` (equities) and the two
BTC-correlated names `MSTRx` (RMSTRUSDT), `COINx` (RCOINUSDT) used by HEDGE and
CLOSE-ONLY. `QQQx`/`SPYx` are index proxies.

## Quickstart

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test     # full suite

# Firewall demos (paper / sim, screenshot-able)
pnpm demo:bypass        # the executor cannot be reached around: 5 attempts, 4 refused
pnpm demo:closeonly     # survival mode: "buy more" BLOCKED, "reduce 50%" APPROVED
pnpm run:scorecard      # aggregate backtest evidence from real Bitget candles
pnpm evidence:run       # full end-to-end native evidence transcript

# Reactor / perception layer (real Bitget public data, paper fills)
pnpm run:bitget-paper
pnpm console:bitget
pnpm backtest:bitget
pnpm --filter @wardenclaw/web dev            # dashboard on http://localhost:3000
```

## Bitget toolchain + MCP servers

- **Agent Hub** wrappers (`packages/bitget-adapter/src/agentHub.ts`) and the official
  Demo Trading executor (`demoExecutor.ts`, `paptrading:1`).
- **Skill Hub** perception skills are declared as gate inputs in `docs/GATE_TABLE.md`
  (sentiment-analyst, news-briefing, technical-analysis, macro-analyst).
- **Bitget MCP server** (perception):
  ```
  claude mcp add -s user --env BITGET_API_KEY=$BITGET_API_KEY \
    --env BITGET_SECRET_KEY=$BITGET_SECRET_KEY --env BITGET_PASSPHRASE=$BITGET_PASSPHRASE \
    bitget -- npx -y bitget-mcp-server
  ```
- **WardenClaw MCP server** (the firewall itself) — register it so any agent must route
  trade intent through it:
  ```
  claude mcp add -s user wardenclaw -- npx tsx scripts/warden-mcp-server.ts
  ```
  Tools: `audit_strategy`, `request_permit`, `verify_permit`, `get_card`,
  `replay_card`, `get_closeonly_status`, `run_ghost_sim`.

## What's implemented

- **`packages/core`** — the deterministic engine: Signal Mandate schema + risk config,
  friction/net-edge/volatility/drawdown primitives, Risk Constitution, watchdog,
  hash-chained audit + replay, backtester, LLM provider layer (parsing only), and the
  firewall modules: `playbookShield`, `wardenCard` (signing/chain), `tradePermit`
  (verdicts + gates), `wardenPermit` (lifecycle), `wardenExecutor` (atomic hedge),
  `closeOnlyWatcher`, `ghostSim`, `evidenceLog`, `mcpServer`.
- **`packages/bitget-adapter`** — real public market data, the shock/cooldown reactor,
  the internal paper engine, the event-shock ranker, the agent stack, the strategy
  compiler clamp + the Playbook Shield wiring (`playbook.ts`), the Agent Hub MCP source,
  and the backtest harness.
- **`apps/web`** — the `/bitget` judge dashboard.

## Safety

Hackathon paper trading, not investment advice. **No real-capital order on any code
path, ever.** Fills are simulated against real Bitget market data and always labeled
`PAPER` / `internal_paper_engine`. Every decision produces a structured, replayable,
signed audit card.

## Environment

Copy `.env.example` to `.env`. The firewall runs fully offline from fixtures with no
keys (deterministic sim mode). `WARDEN_SIGNING_KEY` signs permits (a labeled dev key is
used when absent). Bitget keys enable live perception and the official Demo Trading
executor; absent, everything runs from cached fixtures.

More docs: `docs/{ARCHITECTURE_AUDIT,PLAYBOOK_SHIELD,GATE_TABLE,DEMO_SCRIPT,SUBMISSION_BLURB,COMPLIANCE_CHECKLIST,SETUP,SAFETY,LLM_POLICY}.md`.
