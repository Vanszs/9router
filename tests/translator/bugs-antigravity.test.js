// Real Antigravity-MITM requests (Gemini-internal: { request: { contents, ... } }) → OpenAI.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { getRequestTranslator } from "../../open-sse/translator/registry.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const AG2O = (req) =>
  translateRequest(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, "m", { request: req }, true, null, null);

describe("Antigravity request sanitization", () => {
  it("strips Zed's competitive Claude-agent prompt without mutating other parts", () => {
    const input = {
      request: {
        systemInstruction: {
          role: "system",
          parts: [
            { text: "prefix You are a Claude agent, built on Anthropic's Claude Agent SDK. suffix" },
            { inlineData: { mimeType: "text/plain", data: "keep" } },
            { text: "Keep this prompt." },
          ],
        },
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
      },
      project: "project-1",
    };
    const out = new AntigravityExecutor().transformRequest("gemini-3-flash", input);
    const parts = out.request.systemInstruction.parts;

    expect(parts[0].text).toBe("prefix  suffix");
    expect(parts[1]).toEqual({ inlineData: { mimeType: "text/plain", data: "keep" } });
    expect(parts[2].text).toBe("Keep this prompt.");
    expect(input.request.systemInstruction.parts[0].text).toContain("Claude Agent SDK");
  });
});

describe("Antigravity → OpenAI", () => {
  // antigravity-to-openai.js:177-189 — content with BOTH functionResponse and functionCall/text
  // returns toolResults early → drops the tool calls / text.
  // KNOWN BUG
  it.fails("functionResponse + functionCall in same content keeps both", () => {
    const out = AG2O({
      contents: [{
        role: "model",
        parts: [
          { functionResponse: { id: "c1", name: "prev", response: { result: "done" } } },
          { functionCall: { id: "c2", name: "next", args: {} } },
        ],
      }],
    });
    const json = JSON.stringify(out);
    expect(json, "functionCall lost when sharing content with functionResponse").toContain("\"next\"");
  });

  // antigravity-to-openai.js:167 — functionCall without id gets a random Date.now() id
  // KNOWN BUG: unstable id breaks matching with its functionResponse
  it("functionCall without id keeps a stable matchable id", () => {
    const out = AG2O({
      contents: [
        { role: "model", parts: [{ functionCall: { name: "search", args: { q: "x" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "search", response: { result: "r" } } }] },
      ],
    });
    const asst = out.messages.find((m) => m.tool_calls);
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool?.tool_call_id, "id mismatch between call and response").toBe(asst?.tool_calls?.[0]?.id);
  });

  // antigravity-to-openai.js:144-147 — signature-only part handling (regression guard)
  it("signature-only part does not produce empty text", () => {
    const out = AG2O({
      contents: [{ role: "model", parts: [{ thoughtSignature: "sig", text: "" }] }],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    const content = asst?.content;
    const hasEmpty = Array.isArray(content)
      ? content.some((c) => c.type === "text" && c.text === "")
      : content === "";
    expect(hasEmpty, "empty text part emitted").toBe(false);
  });
});

describe("Antigravity → Claude", () => {
  // Upstream 9router #2225: shared state.toolCalls map between Gemini→OpenAI and
  // OpenAI→Claude translators caused missing content_block_start for tool_use,
  // leading to "API Error: Content block not found" in Claude Code.
  it("tool call input_json_delta includes Anthropic index", () => {
    const state = initState(FORMATS.CLAUDE);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, {
      response: {
        responseId: "resp-1",
        modelVersion: "gemini-pro-agent",
        candidates: [{
          content: {
            role: "model",
            parts: [{ functionCall: { name: "bash", args: { command: "git status" } } }],
          },
          finishReason: "STOP",
          index: 0,
        }],
      },
    }, state);

    const jsonDelta = events.find(
      (event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta"
    );
    expect(jsonDelta).toMatchObject({ index: expect.any(Number) });
    expect(JSON.parse(jsonDelta.delta.partial_json)).toEqual({ command: "git status" });
  });
});

describe("Antigravity executor", () => {
  it("uses the same translator registry as translator modules", () => {
    expect(getRequestTranslator("openai:antigravity")).toBeDefined();
  });

  it("strips optional from nested tool schemas", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-2.5-pro", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{
          functionDeclarations: [{
            name: "lookup",
            description: "Lookup a value",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query",
                  optional: true,
                },
              },
            },
          }],
        }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const query = out.request.tools[0].functionDeclarations[0].parameters.properties.query;
    expect(query).toEqual({ type: "string", description: "Search query" });
  });

  // v1internal rejects a tool declaration carrying BOTH `parameters` and
  // `parametersJsonSchema` ("must not be set when parameters is set").
  // The executor must strip parametersJsonSchema on the v1internal request
  // path only, leaving every other tool schema field intact.
  it("strips parametersJsonSchema on the v1internal tool path", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-3.6-flash-high", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{
          functionDeclarations: [{
            name: "lookup",
            description: "Lookup a value",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
            parametersJsonSchema: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          }],
        }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const decl = out.request.tools[0].functionDeclarations[0];
    expect(decl.parametersJsonSchema).toBeUndefined();
    expect(decl.name).toBe("lookup");
    expect(decl.description).toBe("Lookup a value");
    expect(decl.parameters).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
    });
  });

  // Whitelist fix: Antigravity IDE passthrough sends unexpected OpenAI fields
  // in body.request → Google API rejects with "Unknown name" 400.
  it("whitelists request fields — strips max_tokens, messages, stream, etc.", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-3.5-flash-low", {
      request: {
        // Legitimate Antigravity fields
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        systemInstruction: { role: "user", parts: [{ text: "You are helpful" }] },
        generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
        sessionId: "sess-123",
        // Unexpected fields from Antigravity IDE passthrough (must be stripped)
        max_tokens: 4096,
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.7,
        top_p: 0.9,
        tools: undefined,
        tool_choice: "auto",
        stream: true,
        stream_options: { include_usage: true },
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const req = out.request;
    // Legitimate fields preserved
    expect(req.contents).toBeDefined();
    expect(req.systemInstruction).toBeDefined();
    expect(req.generationConfig).toBeDefined();
    expect(req.sessionId).toBe("sess-123");

    // Unexpected fields stripped
    expect(req.max_tokens).toBeUndefined();
    expect(req.messages).toBeUndefined();
    expect(req.temperature).toBeUndefined();
    expect(req.top_p).toBeUndefined();
    expect(req.tool_choice).toBeUndefined();
    expect(req.stream).toBeUndefined();
    expect(req.stream_options).toBeUndefined();
  });

  it("preserves generationConfig.maxOutputTokens cap at 16384", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-3.5-flash-low", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generationConfig: { maxOutputTokens: 100000 },
      },
    }, true, { projectId: "p", connectionId: "c" });

    expect(out.request.generationConfig.maxOutputTokens).toBe(16384);
  });

  it("preserves translated envelope contents instead of reading nested request.request", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-3.5-flash-low", {
      model: "gemini-3.5-flash-low",
      project: "project-1",
      userAgent: "antigravity",
      requestType: "agent",
      requestId: "agent-existing",
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        systemInstruction: { role: "user", parts: [{ text: "You are helpful" }] },
        generationConfig: { maxOutputTokens: 32 },
        sessionId: "sess-123",
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    expect(out.request.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
    expect(out.request.systemInstruction).toEqual({ role: "user", parts: [{ text: "You are helpful" }] });
    expect(out.request.generationConfig.maxOutputTokens).toBe(32);
    expect(out.request.sessionId).toBe("sess-123");
  });

  // Issue #6: v1internal rejects content entries with empty parts[] (400 on all models)
  it("strips content entries that end up with empty parts after filtering", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-3.5-flash-low", {
      request: {
        contents: [
          { role: "user", parts: [{ text: "prompt" }] },
          { role: "model", parts: [{ thought: true, text: "thinking..." }] },
          { role: "model", parts: [{ thoughtSignature: "sig" }] },
        ],
      },
    }, true, { projectId: "p", connectionId: "c" });

    expect(out.request.contents).toEqual([{ role: "user", parts: [{ text: "prompt" }] }]);
    expect(out.request.contents.every(c => c.parts.length > 0)).toBe(true);
  });

  it("converts Claude image and document blocks to inlineData for Claude Antigravity models", () => {
    const claudeReq = {
      model: "claude-opus-4-6-thinking",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "explain this image" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              },
            },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: "JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2Jq",
              },
            },
          ],
        },
      ],
    };

    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.ANTIGRAVITY,
      "claude-opus-4-6-thinking",
      claudeReq,
      true,
      { projectId: "p", connectionId: "c" }
    );

    const parts = out.request.contents[0].parts;
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: "explain this image" });
    expect(parts[1]).toEqual({
      inlineData: {
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    });
    expect(parts[2]).toEqual({
      inlineData: {
        mimeType: "application/pdf",
        data: "JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2Jq",
      },
    });
  });
});
