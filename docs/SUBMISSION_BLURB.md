# WardenClaw — Track 3 submission blurb (≤200 words)

**WardenClaw is a two-checkpoint command firewall for Bitget tokenized US stocks
(xStocks).** It solves the real problem that destroys tokenized-equity accounts:
unsafe strategies and over-aggressive commands reaching execution.

**Checkpoint 1 — Playbook Shield** audits the strategy before it can run, returning
Certified / Restricted / Rejected over five deterministic checks (leverage, martingale,
missing daily-drawdown cap, missing post-shock cooldown, earnings/first-spike without
confirmation). Restricted hands tightened caps to the strategy compiler; Rejected emits
no mandates.

**Checkpoint 2 — Trade-Permit Engine** audits each trade command, returning APPROVE /
REDUCE / DELAY / HEDGE / BLOCK / CLOSE-ONLY over ten gates — including the asset-class-
native xStock premium/discount gate and a BTC-correlation HEDGE gate. The LLM only
parses; every verdict is deterministic and fail-closed.

Every non-BLOCK verdict yields a **signed (HMAC-SHA256), single-use, expiring, price-
drift-bound, hash-chained Warden Card**; the sim executor verifies it independently —
no valid permit, no execution. Counterfactuals and a 60-command scorecard are **computed
from real Bitget candles**. Evidence is produced natively in the terminal.

Built on Bitget **Agent Hub**, **Skill Hub**, and **two MCP servers** (Bitget's +
WardenClaw's own). Paper/sim only.
