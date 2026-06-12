/**
 * Loader for the canonical prompt files in `src/prompts/`. Keeping prompts as
 * markdown files (not inline strings) keeps them reviewable; this module is the
 * one place that resolves and renders them.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts");

export type PromptName =
  | "strategyCompiler.system.md"
  | "strategyCompiler.user.md"
  | "newsSentimentClassifier.system.md"
  | "auditSummary.system.md"
  | "postTradeReflection.system.md";

export function loadPrompt(name: PromptName): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf8");
}

/** Replace every `{{KEY}}` placeholder; throws if any placeholder is left over. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  const leftover = out.match(/\{\{[A-Z0-9_]+\}\}/);
  if (leftover) {
    throw new Error(`prompt template variable not provided: ${leftover[0]}`);
  }
  return out;
}
