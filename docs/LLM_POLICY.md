# LLM Policy

The LLM is a proposer, never the trader. The deterministic engine decides, the
risk constitution can veto, and the execution adapter only executes approved
mandates.

```
LLM can propose.
Deterministic engine must verify.
Risk Constitution can veto.
Execution adapter only executes approved Signal Mandates.
```

## What the LLM may do

- Compile a natural-language strategy into deterministic JSON (`strategyCompiler.ts`).
- Summarize news / earnings / sentiment into structured objects.
- Classify catalysts.
- Explain trade decisions and produce audit summaries from logs.
- Post-trade reflection (may suggest a parameter review; cannot change live config).

## What the LLM may not do

- Make the final buy/sell decision, size a position, or approve execution.
- Sign transactions.
- Bypass the deterministic score, the risk gates, the net-edge gate, stop
  coherence, the eligible-contract assertion, or the shadow-fill check.
- Invent prices, market data, eligibility, receipts, or tx hashes.
- Raise risk above configured caps. The strategy compiler clamps every risk number
  to the hard caps after the model proposes, so a malicious "ignore risk, all-in"
  prompt is reduced to the configured limits (see `test/strategyCompiler.test.ts`).

## Structured output

Every LLM call validates against a Zod schema (`llm/schemas.ts`). Invalid output is
rejected and repaired once; if still invalid the call fails with a typed error and
no trade occurs (`test/llm.test.ts`).

## Provider selection

```
LLM_PROVIDER=anthropic | openai | local | disabled
```

If `LLM_PROVIDER` is set it wins. Otherwise: anthropic if `ANTHROPIC_API_KEY`,
then openai if `OPENAI_API_KEY`, else disabled. `LLM_ENABLED=false` forces
disabled. In disabled mode the strategy compiler runs from a validated manual JSON
strategy and trading still works deterministically.

Providers are real HTTP clients (`anthropicProvider.ts`, `openaiProvider.ts`,
`localProvider.ts`) that throw loudly when their key/endpoint is missing — they
never substitute fabricated output.
