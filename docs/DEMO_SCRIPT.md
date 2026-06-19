# WardenClaw — 3-minute demo walkthrough

All paper / sim. Every number is computed from real Bitget candles or the engine —
nothing is narrated. Run from the repo root after `pnpm install`.

## 0. One-time

```bash
pnpm typecheck && pnpm test        # 252 tests green
```

## 1. The firewall cannot be bypassed (~30s) — the headline

```bash
pnpm demo:bypass
```

Five attempts hit the sim executor directly: no permit → expired → tampered →
replayed → fresh valid. Only the last executes (paper). Every refusal comes from the
executor's own independent permit check. **This is the proof that "no valid permit =
no execution" is real, not copy.**

## 2. Playbook Shield — checkpoint 1 (~30s)

```bash
pnpm evidence:run        # top of the transcript
```

- An unsafe strategy ("double size after every loss, 10x") → **Rejected**, fails
  `leverage, martingale, daily_drawdown, cooldown` → **no mandates generated**.
- An aggressive-but-salvageable strategy ("4x leverage…") → **Restricted**, caps
  tightened to 35% position / 3x → the compiler runs under the lowered numbers.

## 3. A REDUCE card with a side-by-side ghost sim (~30s)

In the same `evidence:run` transcript: `Long NVDAx $500 5x` in elevated volatility →
**REDUCE** → rewritten to a smaller, 2x, limit order → a signed permit → **executed
(paper)**. The ghost sim shows the original's max drawdown vs the Warden-adjusted
order's, with drawdown avoided in USD — computed, not asserted.

## 4. The xStock premium/discount gate on a weekend command (~15s)

Also in `evidence:run`: a weekend command on an xStock trading at a premium with no
NYSE anchor → the **premium/discount gate fires** → DELAY. This is the asset-class-
native gate that makes WardenClaw unmistakably a tokenized-stock firewall.

## 5. CLOSE-ONLY survival contrast (~30s)

```bash
pnpm demo:closeonly
```

A BTC-correlated 6x long while BTC vol spikes → the watcher flips the account to
**CLOSE-ONLY** (signed state card) → `"buy more"` is **BLOCKED**, `"reduce 50%"` is
**APPROVED + executed (paper)**.

## 6. Aggregate scorecard — the backtest evidence (~30s)

```bash
pnpm run:scorecard
```

60 seeded historical commands through the full engine, ghost-simulated over real
forward candles: verdict distribution, aggregate max drawdown **with vs without**
WardenClaw, liquidations avoided, per-gate trigger frequency. Writes
`output/scorecard.md` + `output/scorecard.json`; re-running yields identical numbers.

## 7. MCP round-trip (optional, ~15s)

Register the WardenClaw MCP server and have an agent call `audit_strategy` →
`request_permit` → submit the permit. The tool-call logs are usage evidence.
```bash
claude mcp add -s user wardenclaw -- npx tsx scripts/warden-mcp-server.ts
```
