/**
 * Proves the configured LLM provider actually answers — a real structured call
 * through the project's own provider stack. Works with OpenAI, or any
 * OpenAI-compatible gateway via OPENAI_BASE_URL (e.g. Alibaba DashScope / Qwen).
 *
 *   pnpm verify:llm
 *
 * Never trades, never signs. The LLM only ever proposes structured JSON.
 */
import "dotenv/config";
import { z } from "zod";
import { createLlmProvider } from "@wardenclaw/core";

async function main(): Promise<void> {
  const provider = createLlmProvider(process.env);
  const base = process.env.OPENAI_BASE_URL || "(provider default)";
  const model = process.env.OPENAI_MODEL || "(provider default)";
  console.log(`provider: ${provider.name} | base: ${base} | model: ${model}`);

  if (provider.name === "disabled") {
    console.log("LLM is DISABLED (deterministic/manual mode). Set LLM_PROVIDER + a key to enable.");
    return;
  }

  const schema = z.object({ ok: z.boolean(), venue: z.string() });
  const out = await provider.generateStructured({
    system: "You are a JSON API. Output only a JSON object, no prose.",
    user: 'Reply with this exact JSON object: {"ok": true, "venue": "bsc"}',
    schema,
  });
  console.log(`✅ live structured call OK → ${JSON.stringify(out)}`);
  console.log("The LLM provider is wired and answering. (It never decides trades.)");
}

main().catch((err) => {
  console.error(`✗ LLM verify failed: ${(err as Error).message}`);
  process.exit(1);
});
