/**
 * Local LLM client for an OpenAI-compatible endpoint (e.g. Ollama, llama.cpp,
 * LM Studio). Throws loudly when no endpoint URL is configured.
 */

import { BaseLlmProvider, type LlmMessage, type LlmProviderName } from "./provider.js";

export interface LocalProviderConfig {
  baseUrl: string;
  model: string;
  maxTokens?: number;
}

export class LocalProvider extends BaseLlmProvider {
  readonly name: LlmProviderName = "local";
  private readonly cfg: Required<LocalProviderConfig>;

  constructor(cfg: LocalProviderConfig) {
    super();
    if (!cfg.baseUrl) throw new Error("LocalProvider requires a baseUrl (LOCAL_LLM_URL)");
    if (!cfg.model) throw new Error("LocalProvider requires a model");
    this.cfg = { maxTokens: 2048, ...cfg };
  }

  protected async complete(messages: LlmMessage, temperature: number): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: this.cfg.maxTokens,
        temperature,
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Local LLM error ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Local LLM returned no content");
    return text;
  }
}
