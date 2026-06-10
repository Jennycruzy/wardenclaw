/**
 * Real Anthropic Messages API client. Throws loudly when the key is missing —
 * it never substitutes fabricated output.
 */

import { BaseLlmProvider, type LlmMessage, type LlmProviderName } from "./provider.js";

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
}

export class AnthropicProvider extends BaseLlmProvider {
  readonly name: LlmProviderName = "anthropic";
  private readonly cfg: Required<AnthropicProviderConfig>;

  constructor(cfg: AnthropicProviderConfig) {
    super();
    if (!cfg.apiKey) throw new Error("AnthropicProvider requires an apiKey");
    if (!cfg.model) throw new Error("AnthropicProvider requires a model");
    this.cfg = {
      baseUrl: "https://api.anthropic.com",
      maxTokens: 2048,
      ...cfg,
    };
  }

  protected async complete(messages: LlmMessage, temperature: number): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: this.cfg.maxTokens,
        temperature,
        system: messages.system,
        messages: [{ role: "user", content: messages.user }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("Anthropic API returned no text content");
    return text;
  }
}
