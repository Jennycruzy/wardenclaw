# Competition Rules

Transcribed from the official DoraHacks page for *BNB Hack: AI Trading Agent
Edition — CoinMarketCap × Trust Wallet*. Verified rules are authoritative. The
four open items carry conservative defaults that are authoritative until an
organizer confirms otherwise; updating one config value is the only change needed
if answers arrive. Run `pnpm verify:competition-rules` to check this registry.

---

```
rule: Track 1 trades live spot on BSC, June 22–28, 2026
source: DoraHacks official page (transcribed 2026-06-09)
status: verified
exact_value: 2026-06-22 .. 2026-06-28
implementation_file: packages/core/src/config.ts
```

```
rule: Ranked by total return; max drawdown cap is a disqualification gate
source: DoraHacks official page (transcribed 2026-06-09)
status: verified
exact_value: "most profit without blowing up"
implementation_file: packages/core/src/drawdownGovernor.ts
```

```
rule: Minimum trades — at least 1 per day, 7 over the trading week
source: DoraHacks official page (transcribed 2026-06-09)
status: verified
exact_value: 1/day, 7/week
implementation_file: packages/core/src/config.ts
```

```
rule: Returns measured hour by hour; an hour starting at <= $1 scores 0%
source: DoraHacks official page (transcribed 2026-06-09)
status: verified
exact_value: $1.00 floor
implementation_file: packages/core/src/hourlySnapshot.ts
```

```
rule: Must hold a non-zero balance of in-scope assets at competition start
source: DoraHacks official page (transcribed 2026-06-09)
status: verified
exact_value: eligible BEP-20 tokens (native BNB does not count)
implementation_file: packages/core/src/eligibleTokens.ts
```

```
rule: Trades outside the eligible token list do not count
source: DoraHacks official page (transcribed 2026-06-09)
status: verified
exact_value: address-keyed eligible list
implementation_file: packages/core/src/eligibleTokens.ts
```

```
rule: On-chain registration via the competition contract before the window opens
source: DoraHacks official page (transcribed 2026-06-09)
status: verified
exact_value: 0x212c61b9b72c95d95bf29cf032f5e5635629aed5 (twak compete register / competition_register)
implementation_file: packages/core/src/config.ts
```

```
rule: Simulated transaction costs are applied in scoring
source: DoraHacks official page (transcribed 2026-06-09)
status: verified
exact_value: charged inside the friction model
implementation_file: packages/core/src/frictionModel.ts
```

## Open items (dashboard warnings until confirmed)

```
rule: Exact disqualification drawdown percentage and measurement basis
source: DoraHacks official page (transcribed 2026-06-09)
status: needs-organizer-confirmation
exact_value: 30% indicative (page example); presumed whole-window peak-to-trough
implementation_file: packages/core/src/config.ts
```

```
rule: Exact simulated-transaction-cost amount/model used in scoring
source: DoraHacks official page (transcribed 2026-06-09)
status: needs-organizer-confirmation
exact_value: SCORING_SIM_COST_BPS=10 per leg (conservative default)
implementation_file: packages/core/src/frictionModel.ts
```

```
rule: Whether WBNB hops / native BNB count as in-scope
source: DoraHacks official page (transcribed 2026-06-09)
status: needs-organizer-confirmation
exact_value: presume not held as a position; WBNB allowed only as a route hop
implementation_file: packages/core/src/eligibleTokens.ts
```

```
rule: The 149-vs-enumerated eligible-token count discrepancy
source: DoraHacks official page (transcribed 2026-06-09)
status: needs-organizer-confirmation
exact_value: enumerated list treated as working truth; SLX duplicated, USDf/USDF both present
implementation_file: data/eligible-tokens.json
```

## Eligible token handling

- Native BNB is **not** on the list (it is not a BEP-20 token). BNB is gas only;
  ranked positions must be held in eligible BEP-20 tokens.
- WBNB is **not** enumerated. It may appear only as an intermediate route hop on
  PancakeSwap, never as a held position.
- The allowlist is keyed by **exact BEP-20 contract address**, never by symbol
  (symbols like B, M, U, H, BRETT, TOSHI, REAL, OPEN have multiple BSC contracts).
- `pnpm build:eligible-tokens` resolves each symbol to its CMC-listed BSC contract
  and writes `data/eligible-tokens.json`. Unresolvable symbols are excluded and
  logged.
