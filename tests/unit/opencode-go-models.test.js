import { describe, expect, it } from "vitest";
import {
  PROVIDER_MODELS,
  getModelSupportedFormats,
  getModelTargetFormat,
} from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import "../translator/registerAll.js";

// Chat-only models (no /messages, no /responses support on opencode-go)
const CHAT_ONLY = [
  "glm-5.2",
  "glm-5.1",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "mimo-v2.5",
  "mimo-v2.5-pro",
];
// Models that also expose the Anthropic /messages endpoint
const CLAUDE_CAPABLE = [
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
];
// Models that also expose the OpenAI /responses endpoint
const RESPONSES_CAPABLE = ["deepseek-v4-pro", "deepseek-v4-flash"];
// Models served exclusively by the OpenAI /responses endpoint
const RESPONSES_ONLY = ["muse-spark-1.2-contributor"];

// Mirror of chatCore's per-model transport guard: use the sourceFormat-matched
// transport only when the model declares support for that sourceFormat.
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  return supported?.includes(sourceFormat) ? rt : null;
}

describe("OpenCode Go model catalog", () => {
  it("matches the documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id);
    expect(ids).toEqual([
      "glm-5.3-flash",
      "glm-5.2",
      "glm-5.1",
      "gpt-5.6-luna",
      "grok-4.6",
      "kimi-k2.7-code",
      "kimi-k2.6",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "minimax-m3",
      "minimax-m2.7",
      "minimax-m2.5",
      "muse-spark-1.2-contributor",
      "muse-spark-1.3-contributor",
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.6-plus",
    ]);
  });
});

describe("OpenCode Go per-model supportedFormats", () => {
  it("declares [openai, claude] for MiniMax + Qwen models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual([
        "openai",
        "claude",
      ]);
    }
  });

  it("declares [openai, claude, openai-responses] for DeepSeek models", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual([
        "openai",
        "claude",
        "openai-responses",
      ]);
    }
  });

  it("declares [openai] only for chat-only models (GLM/Kimi/MiMo) → guards /messages routing", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai"]);
    }
  });
});

describe("OpenCode Go multi-endpoint transports", () => {
  it("declares openai / claude / openai-responses transports", () => {
    const formats = (PROVIDERS["opencode-go"].transports || []).map(
      (t) => t.format,
    );
    expect(formats).toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolveTransport picks the endpoint matching the client sourceFormat", () => {
    expect(resolveTransport("opencode-go", "claude").baseUrl).toBe(
      "https://opencode.ai/zen/go/v1/messages",
    );
    expect(resolveTransport("opencode-go", "openai-responses").baseUrl).toBe(
      "https://opencode.ai/zen/go/v1/responses",
    );
    expect(resolveTransport("opencode-go", "openai").baseUrl).toBe(
      "https://opencode.ai/zen/go/v1/chat/completions",
    );
  });

  it("uses x-api-key + anthropicVersion on the claude transport", () => {
    const t = resolveTransport("opencode-go", "claude");
    expect(t.auth.header).toBe("x-api-key");
    expect(t.auth.anthropicVersion).toBe(true);
  });
});

describe("OpenCode Go per-model transport guard (chatCore logic)", () => {
  it("routes MiniMax/Qwen + claude-format client to /messages", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(
        pickTransport("opencode-go", "claude", "opencode-go", m)?.baseUrl,
      ).toBe("https://opencode.ai/zen/go/v1/messages");
    }
  });

  it("does NOT route chat-only models to /messages on a claude-format request", () => {
    for (const m of CHAT_ONLY) {
      expect(
        pickTransport("opencode-go", "claude", "opencode-go", m),
      ).toBeNull();
    }
  });

  it("routes DeepSeek + responses-format client to /responses", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(
        pickTransport("opencode-go", "openai-responses", "opencode-go", m)
          ?.baseUrl,
      ).toBe("https://opencode.ai/zen/go/v1/responses");
    }
  });

  it("does NOT route MiniMax (no responses support) to /responses", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(
        pickTransport("opencode-go", "openai-responses", "opencode-go", m),
      ).toBeNull();
    }
  });
});

describe("OpenCode Go session affinity headers", () => {
  it("sends x-opencode-session on every request (chat, messages, responses)", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = { apiKey: "test", connectionId: "conn-1" };
    for (const [model, expectedUrl] of [
      ["glm-5.2", "https://opencode.ai/zen/go/v1/chat/completions"],
      ["minimax-m3", "https://opencode.ai/zen/go/v1/messages"],
      ["deepseek-v4-flash", "https://opencode.ai/zen/go/v1/chat/completions"],
    ]) {
      executor.buildUrl(model);
      const headers = executor.buildHeaders(creds, true);
      expect(headers["x-opencode-session"]).toBeTruthy();
      expect(executor.buildUrl(model)).toBe(expectedUrl);
    }
  });

  it("keeps the session stable across turns of one conversation", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = { apiKey: "test", connectionId: "conn-1" };
    const body = { model: "glm-5.2", messages: [{ role: "user", content: "hi" }] };
    executor.buildUrl("glm-5.2");
    executor.transformRequest("glm-5.2", body, true, creds);
    const first = executor.buildHeaders(creds, true)["x-opencode-session"];
    const second = executor.buildHeaders(creds, true)["x-opencode-session"];
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("client-provided x-opencode-session header wins", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = {
      apiKey: "test",
      rawHeaders: { "x-opencode-session": "client-provided-session" },
    };
    executor.buildUrl("glm-5.2");
    const headers = executor.buildHeaders(creds, true);
    expect(headers["x-opencode-session"]).toBe("client-provided-session");
  });

  it("sets the full x-opencode-* header family", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = { apiKey: "test" };
    executor.buildUrl("glm-5.2");
    const headers = executor.buildHeaders(creds, true);
    expect(headers["x-opencode-client"]).toBe("desktop");
    expect(headers["x-opencode-session"]).toMatch(/^ses_/);
    expect(headers["x-opencode-request"]).toMatch(/^msg_/);
    expect(headers["x-opencode-project"]).toBe("global");
    expect(headers["Authorization"]).toBe("Bearer test");
  });

  it("keeps x-api-key auth on messages-format models while adding session headers", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = { apiKey: "test" };
    executor.buildUrl("minimax-m3");
    const headers = executor.buildHeaders(creds, true);
    expect(headers["x-api-key"]).toBe("test");
    expect(headers["anthropic-version"]).toBeDefined();
    expect(headers["x-opencode-session"]).toMatch(/^ses_/);
  });
});

describe("OpenCode Go Muse Spark (responses-only model)", () => {
  it("declares openai-responses as the only supported format and target", () => {
    for (const m of RESPONSES_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual([
        "openai-responses",
      ]);
      expect(getModelTargetFormat("opencode-go", m)).toBe("openai-responses");
    }
  });

  it("translates an OpenAI Chat request to the Responses shape (no `messages` upstream)", () => {
    const body = {
      model: "ocg/muse-spark-1.2-contributor",
      messages: [{ role: "user", content: "Think, then answer: 2 + 2?" }],
      reasoning_effort: "max",
      max_tokens: 131072,
    };

    // Mirrors chatCore targetFormat resolution: transport guard (openai not in
    // supportedFormats) → null, model-level targetFormat → openai-responses.
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "muse-spark-1.2-contributor",
      body,
      true,
      {},
      "opencode-go",
    );
    const out = new OpenCodeGoExecutor().transformRequest(
      "muse-spark-1.2-contributor",
      translated,
      true,
      {},
    );

    expect(out.input).toBeDefined();
    expect(out.messages).toBeUndefined();
    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(out.max_output_tokens).toBe(131072);
    expect(out.max_tokens).toBeUndefined();
  });

  it("routes Muse Spark to /responses only", () => {
    const executor = new OpenCodeGoExecutor();
    expect(executor.buildUrl("muse-spark-1.2-contributor")).toBe(
      "https://opencode.ai/zen/go/v1/responses",
    );
  });
});
