# Operations Runbook (VPS, live window June 22–28)

The agent runs unattended for 7 days. Ops failures lose the competition as surely
as bad trades — a crashed agent also misses the verified 1-trade/day minimum.

## Processes

Two processes under pm2 (`ops/pm2.config.cjs`):
- **wardenclaw-worker** — the trading loop (perception → gates → execute → snapshot).
- **wardenclaw-api** — the phone-reachable control surface (health + kill-switch).

```bash
pnpm install
pm2 start ops/pm2.config.cjs
pm2 save && pm2 startup      # start on reboot
pm2 logs wardenclaw-worker     # follow the loop
pm2 restart wardenclaw-worker  # manual restart (recovery runs automatically)
```

Both auto-restart with backoff. On every start the worker runs **crash-recovery
reconciliation BEFORE any trade**: it reconciles pending/in-flight txs against
chain state, resolves submitted-but-unconfirmed txs by checking the chain (never
blind re-submission), checks nonce reuse, and writes a `RECOVERY_REPORT` audit
event. No duplicate trades, ever.

## Required environment (live)

```
CMC_API_KEY=…            # real perception (worker fails loud without it)
TWAK_CONFIG_PATH=…       # the sole signer; enables live mode
BSC_RPC_URLS=u1,u2,u3    # failover pool
ALERT_WEBHOOK_URL=…      # phone alerts
KILL_SWITCH_TOKEN=…      # authenticated emergency stop
```

Run `pnpm verify:integrations -- --live` — it exits non-zero if any required live
integration is missing.

## The emergency stop (STOP TRADING NOW)

From a phone browser or terminal:

```bash
curl -X POST $NEXT_PUBLIC_API_URL/kill -H "authorization: Bearer $KILL_SWITCH_TOKEN"
```

This writes a kill flag the worker honors on its next cycle: it halts new entries,
would cancel pending intents, and attempts approval revocation, then alerts. Check
state at `GET /health` or the `/bsc/ops` dashboard page.

## Alerts (to your phone)

`ALERT_WEBHOOK_URL` receives: survival-mode entry, execution failure, TWAK refusal,
restart/recovery, **daily-trade-at-risk** (hours before day end with 0 trades),
drawdown soft-threshold breach, and emergency stop. Alert delivery never throws —
a failed alert cannot crash the loop. Test it: `POST /alert/test` (Bearer token).

## Responding to each alert

| Alert | Action |
|---|---|
| `restart_recovery` (requires review) | Inspect the RECOVERY_REPORT; do not resubmit pending txs — resolve from chain. |
| `daily_trade_at_risk` | The agent will run a stable↔stable Micro-Scout if safe; if it held (unsafe), decide whether to intervene. |
| `survival_mode` / `drawdown_soft` | The governor is de-risking automatically. Verify on `/bsc/proof`. |
| `execution_failure` | Check `pm2 logs`; the loop continues. If persistent (e.g. RPC), check `BSC_RPC_URLS`. |
| `twak_refusal` | Expected when a bad intent was blocked; confirm it was not a mis-config. |
| `emergency_stop` | You (or a watchdog) engaged the kill-switch. Restart only after review. |

## Heartbeat & RPC failover

The worker writes a heartbeat each cycle (`data/runtime/heartbeat.json`); a stale
heartbeat (3× the interval) means the process manager should restart it — an alert
fires. The RPC manager probes its pool and fails over automatically; it throws
rather than hangs when the whole pool is down.

## Reading logs and audit

- `pm2 logs` — live process output.
- `data/audit/*.jsonl` — hash-chained per-stage events. Replay one:
  `pnpm replay --mandate <id>`.
- `data/audit/*.mandates.jsonl` — full mandates rendered on the dashboard.
- `data/audit/*.snapshots.jsonl` — hourly portfolio values (mirror the scoring).
