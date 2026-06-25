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

## The problem

AI trading agents on Bitget xStocks can be prompted, mis-tuned, or hallucinate their
way into account-destroying trades — over-leverage, martingale averaging-down, buying
into an earnings spike, or chasing a tokenized stock trading at a wild premium to its
underlying. Generic risk tooling misses the asset-class-specific traps (xStock
premium/discount, US-market-hours, BTC correlation), and once a reckless command reaches
the exchange it is already too late. **The agent is allowed to be the strategist; it
should never be the last line of defense on risk.**

WardenClaw inserts that missing line of defense: a deterministic command firewall
between the agent and execution. An unsafe *strategy* never emits a single trade, and
every individual *command* must earn a signed, verifiable permit before any (paper) order
— so a compromised or careless agent cannot push risk it was never authorized to take.

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

- **Checkpoint 1 — Playbook Shield** (audits the STRATEGY, pre-flight): three strategy
  verdicts (Certified / Restricted / Rejected) over five deterministic static checks
  (leverage, martingale, missing daily-drawdown cap, missing post-shock cooldown,
  earnings/first-spike without confirmation), plus a conditional overfit check. A
  **Rejected** strategy emits no mandates at all; **Restricted** runs only under
  tightened caps. The LLM never participates in this verdict. See `docs/PLAYBOOK_SHIELD.md`.
- **Checkpoint 2 — Trade-Permit Engine** (audits each TRADE command, at execution time):
  six trade verdicts (APPROVE / REDUCE / DELAY / HEDGE / BLOCK / CLOSE-ONLY) over ten
  deterministic gates, including the asset-class-native **xStock premium/discount** gate
  and the BTC-correlation HEDGE gate. See `docs/GATE_TABLE.md`.
- **Warden Permit** — every non-BLOCK verdict produces a signed (HMAC-SHA256),
  single-use, expiring, price-drift-bound, hash-chained permit. The executor verifies
  it independently before any (paper) order.

### What each verdict means (and what actually triggers it)

The six are **trade** verdicts (Checkpoint 2). They are resolved in strict precedence —
`CLOSE-ONLY > BLOCK > DELAY > HEDGE > REDUCE > APPROVE` — so the most protective
applicable verdict wins. Full thresholds live in `docs/GATE_TABLE.md`.

| Verdict | What actually triggers it | Effect on the order |
|---|---|---|
| **APPROVE** | Passes all required gates | Executes as requested |
| **REDUCE** | Command too aggressive for current conditions — xStock premium > 1.5% (> 0.75% when the **US market is closed**), volatility > 80th pct, or liquidation distance < 8% | Engine **rewrites** the order (smaller size, lower leverage, market→limit) and permits *that* |
| **DELAY** | Not rejected, just not now — spread > 50 bps, xStock premium > 3%, a news first-spike < 15 min old, or missing post-news confirmation | Returns a concrete recheck condition; no order yet |
| **HEDGE** | Asset is in the BTC-correlated set **and** BTC realized vol is rising | Smaller primary leg **plus** an enforced protective `hedge_leg` (atomic two-leg bundle) |
| **BLOCK** | A major gate fails — earnings window with leverage > 2×, liquidation distance < 4%, or any required feed older than 60s (fail-closed) | Nothing executes; **no permit is issued** |
| **CLOSE-ONLY** | Account is in drawdown **survival mode** | Only reduce/close/cancel permitted; every exposure-increasing command is refused |

> **Note on US market hours:** the market-session gate never blocks on its own — when the
> US market is closed it only *tightens the xStock premium gate* (the 1.5% threshold drops
> to 0.75%), which is what pushes borderline orders into **REDUCE** and then **DELAY** as the
> premium widens. **HEDGE**, **BLOCK**, and **CLOSE-ONLY** are driven by other gates, not the clock.

> **`REJECT` is different:** it is a Checkpoint 1 **strategy** verdict (Playbook Shield emits
> Certified / Restricted / **Rejected**), not a trade verdict. A Rejected strategy emits **no
> mandates at all**, so Checkpoint 2 never runs for it.

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
pnpm backtest:bitget -- NVDAx
pnpm backtest:all                         # refresh all five verified assets
pnpm --filter @wardenclaw/web dev            # dashboard on http://localhost:3000
```

Production installs `ops/warden-backtests.{service,timer}` to refresh all five
real-candle backtests hourly. The timer fails loudly if Bitget data is unavailable;
it never substitutes synthetic candles.

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
- **WardenClaw MCP server** (the firewall itself) — register it so any Claude/Cursor
  agent must route trade intent through both checkpoints before it can reach Bitget:
  ```
  claude mcp add -s user wardenclaw -- npx tsx scripts/warden-mcp-server.ts
  ```
  Seven stdio JSON-RPC tools, mapped to the two checkpoints:
  - **Checkpoint 1:** `audit_strategy`
  - **Checkpoint 2:** `request_permit`, `verify_permit`
  - Permit lifecycle / evidence: `get_card`, `replay_card`, `get_closeonly_status`, `run_ghost_sim`.

  The deterministic engine produces every verdict — the agent calling these tools never
  gets to make a risk decision. Server logic lives in `packages/core/src/mcpServer.ts`
  (pure, tested); the transport is a thin wrapper in `scripts/warden-mcp-server.ts`.

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
