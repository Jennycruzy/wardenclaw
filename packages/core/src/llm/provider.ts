/**
 * LLM provider abstraction. Every structured call validates against a Zod schema,
 * retries once with a repair instruction on invalid output, and otherwise throws
 * a typed error so callers can fail safe. Providers are real HTTP clients that
 * throw loudly when their key/endpoint is missing — never silent fakes.
 *
 * The contract for trading safety: the LLM proposes structured objects only. It
 * never returns executable orders, prices, or gate verdicts; those come from the
 * deterministic engine regardless of what a provider says.
 */

import type { ZodType } from "zod";

export type LlmProviderName = "anthropic" | "openai" | "local" | "disabled";

export interface LlmMessage {
  system: string;
  user: string;
}

export interface GenerateStructuredOptions<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  temperature?: number;
  /** Defaults to 1 retry (two attempts total). */
  maxRepairRetries?: number;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  generateStructured<T>(opts: GenerateStructuredOptions<T>): Promise<T>;
}

export class LlmDisabledError extends Error {
  constructor(message = "LLM disabled: deterministic/manual mode active") {
    super(message);
    this.name = "LlmDisabledError";
  }
}

export class LlmStructuredError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProviderName,
    readonly lastRaw?: string,
  ) {
    super(message);
    this.name = "LlmStructuredError";
  }
}

/** Pull the first JSON object out of a model response, tolerating code fences. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new SyntaxError("no JSON object found in model output");
  }
  return JSON.parse(body.slice(start, end + 1));
}

const REPAIR_HINT =
  "Your previous output was not valid JSON matching the required schema. " +
  "Reply with ONLY the corrected JSON object, no prose, no code fences.";

/**
 * Shared structured-generation loop. Concrete providers implement `complete`
 * (one raw text completion); this validates, repairs once, then fails typed.
 */
export abstract class BaseLlmProvider implements LlmProvider {
  abstract readonly name: LlmProviderName;
  protected abstract complete(messages: LlmMessage, temperature: number): Promise<string>;

  async generateStructured<T>(opts: GenerateStructuredOptions<T>): Promise<T> {
    const maxRetries = opts.maxRepairRetries ?? 1;
    const temperature = opts.temperature ?? 0.1;
    let user = opts.user;
    let lastRaw: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const raw = await this.complete({ system: opts.system, user }, temperature);
      lastRaw = raw;
      try {
        const parsed = extractJson(raw);
        return opts.schema.parse(parsed);
      } catch {
        user = `${opts.user}\n\n${REPAIR_HINT}\n\nInvalid output was:\n${raw}`;
      }
    }
    throw new LlmStructuredError(
      `failed to produce schema-valid output after ${maxRetries + 1} attempts`,
      this.name,
      lastRaw,
    );
  }
}

/** A provider that always refuses — drives manual/deterministic mode. */
export class DisabledProvider implements LlmProvider {
  readonly name = "disabled" as const;
  async generateStructured<T>(_opts?: GenerateStructuredOptions<T>): Promise<T> {
    throw new LlmDisabledError();
  }
}

export interface ProviderEnv {
  LLM_PROVIDER?: string;
  LLM_ENABLED?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LOCAL_LLM_URL?: string;
}

export interface ProviderSelection {
  name: LlmProviderName;
  enabled: boolean;
  reason: string;
}

/**
 * Resolve which provider to use. Explicit LLM_PROVIDER wins; otherwise prefer
 * anthropic if its key exists, then openai, else disabled. LLM_ENABLED=false
 * forces disabled regardless.
 */
export function selectProvider(env: ProviderEnv): ProviderSelection {
  if (env.LLM_ENABLED === "false") {
    return { name: "disabled", enabled: false, reason: "LLM_ENABLED=false" };
  }
  const explicit = env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === "disabled") {
    return { name: "disabled", enabled: false, reason: "LLM_PROVIDER=disabled" };
  }
  if (explicit === "anthropic" || explicit === "openai" || explicit === "local") {
    return { name: explicit, enabled: true, reason: `LLM_PROVIDER=${explicit}` };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { name: "anthropic", enabled: true, reason: "ANTHROPIC_API_KEY present" };
  }
  if (env.OPENAI_API_KEY) {
    return { name: "openai", enabled: true, reason: "OPENAI_API_KEY present" };
  }
  return { name: "disabled", enabled: false, reason: "no provider key configured" };
}
