# Safety

This is hackathon trading, not investment advice. The defaults target a ~$40
spot-only book under the verified Track 1 rules.

## Custody

- **TWAK is the sole signer.** The private key stays local with Trust Wallet Agent
  Kit. The backend (API + worker) produces Signal Mandates and **cannot move
  funds**. No private key is ever committed, stored in the backend, or written to a
  database. `.gitignore` excludes `*.key`, `*.pem`, and `twak-config.json`.

## Non-negotiable execution invariants

Enforced twice — by the Risk Constitution upstream and by TWAK's local policy at
the signer (defense in depth). Every refusal carries a deterministic reject code:

- Spot-only on BSC mainnet (chainId 56); any leverage/perp/margin route → `REJECT_NON_SPOT`.
- Both swap legs on the address-keyed eligible list → else `REJECT_INELIGIBLE_CONTRACT`.
- Never hold native BNB or WBNB as a position → `REJECT_HELD_NATIVE_OR_WBNB`.
- Allowlisted router/spender/contract only.
- No infinite approvals by default; approval ≤ mandate amount + small buffer.
- Per-trade and daily spend caps; slippage cap.
- The decoded transaction action must match the approved mandate.
- No trade on stale market data or stale calibration.
- No trade below the portfolio danger threshold.

## Economic safety

- **Net-edge gate:** no trade unless expected move clears real friction + the
  competition's simulated cost + margin.
- **Volatility-derived stops; size derived from the stop.** Incoherent (too-small,
  too-costly) sizes are skipped, not forced.
- **Three-layer drawdown governor:** never approaches the disqualification cap;
  spends a budgeted internal window allowance; de-risks automatically.
- **Shadow-fill guard:** aborts a swap whose simulated output deviates beyond
  tolerance (thin liquidity / moved price / sandwich risk).

## Operational safety

- Phone-reachable, authenticated **kill-switch**; alerts for every key event.
- **Crash-recovery reconciliation** before any trade — no duplicate trades.
- **RPC failover** — never hang on a dead endpoint.
- **Dress-rehearsal gate** — live mode refuses to start unless §0.12 passed.

## The LLM is never the trader

The LLM may compile strategy, classify news, and summarize — it can never make a
final buy/sell decision, size a position, approve execution, sign, or bypass any
gate. Invalid or hallucinated LLM output is rejected and the system fails safe.
See `docs/LLM_POLICY.md`.

## No fabrication

Where an integration is unavailable or unverified it **fails loudly** with a clear
TODO — it is never silently replaced with fake data. Bitget paper trading is the
only simulation allowance, and its fills are always labeled simulated.

## No token activity during the event

No token launches, fundraising, liquidity opening, or airdrop activity before
results are announced (verified rule).
