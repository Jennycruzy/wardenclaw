/**
 * Real OpenAI Chat Completions client. Throws loudly when the key is missing.
 */

import { BaseLlmProvider, type LlmMessage, type LlmProviderName } from "./provider.js";

export interface OpenAiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
}

export class OpenAiProvider extends BaseLlmProvider {
  readonly name: LlmProviderName = "openai";
  private readonly cfg: Required<OpenAiProviderConfig>;

  constructor(cfg: OpenAiProviderConfig) {
    super();
    if (!cfg.apiKey) throw new Error("OpenAiProvider requires an apiKey");
    if (!cfg.model) throw new Error("OpenAiProvider requires a model");
    this.cfg = {
      baseUrl: "https://api.openai.com/v1",
      maxTokens: 2048,
      ...cfg,
    };
  }

  protected async complete(messages: LlmMessage, temperature: number): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: this.cfg.maxTokens,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI API error ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI API returned no content");
    return text;
  }
}
