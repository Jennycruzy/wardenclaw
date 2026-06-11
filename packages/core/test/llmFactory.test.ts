import { describe, it, expect } from "vitest";
import { createLlmProvider, DisabledProvider, OpenAiProvider, type LlmFactoryEnv } from "../src/llm/index.js";

describe("createLlmProvider", () => {
  it("returns DisabledProvider when LLM_ENABLED=false", () => {
    const p = createLlmProvider({ LLM_ENABLED: "false", OPENAI_API_KEY: "k" });
    expect(p).toBeInstanceOf(DisabledProvider);
    expect(p.name).toBe("disabled");
  });

  it("returns DisabledProvider when no key is configured", () => {
    const p = createLlmProvider({});
    expect(p).toBeInstanceOf(DisabledProvider);
  });

  it("builds an OpenAI-compatible provider for LLM_PROVIDER=openai", () => {
    const env: LlmFactoryEnv = {
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "qwen-plus",
    };
    const p = createLlmProvider(env);
    expect(p).toBeInstanceOf(OpenAiProvider);
    expect(p.name).toBe("openai");
  });

  it("targets a custom OPENAI_BASE_URL (e.g. DashScope/Qwen) without clobbering the default", () => {
    const dashscope = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    const p = createLlmProvider({
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "qwen-plus",
      OPENAI_BASE_URL: dashscope,
    }) as OpenAiProvider;
    expect(p.name).toBe("openai");
    // the configured base URL is what the request will hit
    expect((p as unknown as { cfg: { baseUrl: string } }).cfg.baseUrl).toBe(dashscope);
  });

  it("openai with a base url but missing key degrades to disabled", () => {
    const p = createLlmProvider({ LLM_PROVIDER: "openai", OPENAI_BASE_URL: "https://x/v1" });
    expect(p).toBeInstanceOf(DisabledProvider);
  });
});
