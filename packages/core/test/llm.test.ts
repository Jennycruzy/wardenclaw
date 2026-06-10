import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  BaseLlmProvider,
  DisabledProvider,
  LlmDisabledError,
  LlmStructuredError,
  extractJson,
  selectProvider,
  type LlmMessage,
} from "../src/index.js";

/** A test provider that returns scripted raw completions in order. */
class ScriptedProvider extends BaseLlmProvider {
  readonly name = "local" as const;
  private calls = 0;
  constructor(private readonly outputs: string[]) {
    super();
  }
  protected async complete(_m: LlmMessage, _t: number): Promise<string> {
    const out = this.outputs[Math.min(this.calls, this.outputs.length - 1)];
    this.calls++;
    return out ?? "";
  }
  get callCount() {
    return this.calls;
  }
}

const schema = z.object({ score: z.number(), label: z.string() });

describe("extractJson", () => {
  it("parses fenced and unfenced JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"a":2} suffix')).toEqual({ a: 2 });
  });
  it("throws when no object present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("selectProvider", () => {
  it("honors explicit provider", () => {
    expect(selectProvider({ LLM_PROVIDER: "openai" }).name).toBe("openai");
  });
  it("forces disabled when LLM_ENABLED=false", () => {
    expect(selectProvider({ LLM_ENABLED: "false", ANTHROPIC_API_KEY: "x" }).enabled).toBe(false);
  });
  it("prefers anthropic then openai by key presence", () => {
    expect(selectProvider({ ANTHROPIC_API_KEY: "a" }).name).toBe("anthropic");
    expect(selectProvider({ OPENAI_API_KEY: "o" }).name).toBe("openai");
  });
  it("disables when no key present", () => {
    expect(selectProvider({}).name).toBe("disabled");
  });
});

describe("structured generation", () => {
  it("returns valid structured output", async () => {
    const p = new ScriptedProvider(['{"score": 7, "label": "ok"}']);
    const out = await p.generateStructured({ system: "s", user: "u", schema });
    expect(out).toEqual({ score: 7, label: "ok" });
  });

  it("repairs once on invalid JSON then succeeds", async () => {
    const p = new ScriptedProvider(["not json", '{"score": 1, "label": "fixed"}']);
    const out = await p.generateStructured({ system: "s", user: "u", schema });
    expect(out.label).toBe("fixed");
    expect(p.callCount).toBe(2);
  });

  it("rejects output that violates the schema (hallucinated shape)", async () => {
    const p = new ScriptedProvider(['{"score": "high", "label": 5}']);
    await expect(p.generateStructured({ system: "s", user: "u", schema })).rejects.toBeInstanceOf(
      LlmStructuredError,
    );
  });

  it("DisabledProvider always refuses", async () => {
    await expect(
      new DisabledProvider().generateStructured({ system: "s", user: "u", schema }),
    ).rejects.toBeInstanceOf(LlmDisabledError);
  });
});
