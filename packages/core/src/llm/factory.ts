/**
 * Build a concrete LLM provider from environment config. This is the single place
 * that turns a ProviderSelection into a live HTTP client, reading endpoint/model
 * overrides from env so the same OpenAI-compatible client can target OpenAI,
 * Alibaba Cloud DashScope / Qwen, Together, etc. via OPENAI_BASE_URL.
 *
 * The LLM only ever proposes structured JSON; the deterministic engine decides.
 * Returns a DisabledProvider (manual/deterministic mode) whenever no provider is
 * enabled or a required key/endpoint is missing — it never throws, so callers
 * degrade gracefully.
 */

import {
  DisabledProvider,
  selectProvider,
  type LlmProvider,
  type ProviderEnv,
} from "./provider.js";
import { OpenAiProvider, type OpenAiProviderConfig } from "./openaiProvider.js";
import { AnthropicProvider, type AnthropicProviderConfig } from "./anthropicProvider.js";
import { LocalProvider } from "./localProvider.js";

export interface LlmFactoryEnv extends ProviderEnv {
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
  LOCAL_MODEL?: string;
}

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const DEFAULT_LOCAL_MODEL = "local-model";

/**
 * Resolve and instantiate the configured provider.
 *
 * @param env   environment to read (defaults to process.env).
 * @param model optional per-call model override (beats the env default).
 */
export function createLlmProvider(
  env: LlmFactoryEnv = process.env as LlmFactoryEnv,
  model?: string,
): LlmProvider {
  const selection = selectProvider(env);
  if (!selection.enabled) return new DisabledProvider();

  switch (selection.name) {
    case "openai": {
      if (!env.OPENAI_API_KEY) return new DisabledProvider();
      const cfg: OpenAiProviderConfig = {
        apiKey: env.OPENAI_API_KEY,
        model: model ?? env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
      };
      // Only set baseUrl when provided — passing undefined would clobber the
      // provider's own default via object spread.
      if (env.OPENAI_BASE_URL) cfg.baseUrl = env.OPENAI_BASE_URL;
      return new OpenAiProvider(cfg);
    }
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) return new DisabledProvider();
      const cfg: AnthropicProviderConfig = {
        apiKey: env.ANTHROPIC_API_KEY,
        model: model ?? env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
      };
      if (env.ANTHROPIC_BASE_URL) cfg.baseUrl = env.ANTHROPIC_BASE_URL;
      return new AnthropicProvider(cfg);
    }
    case "local": {
      if (!env.LOCAL_LLM_URL) return new DisabledProvider();
      return new LocalProvider({
        baseUrl: env.LOCAL_LLM_URL,
        model: model ?? env.LOCAL_MODEL ?? DEFAULT_LOCAL_MODEL,
      });
    }
    default:
      return new DisabledProvider();
  }
}
