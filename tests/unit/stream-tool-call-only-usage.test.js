// Regression test for the "claude-sonnet-5 ... 0↓" bug reported live:
// agentic tool-call-only turns (e.g. Claude Code / builder combo with 200+
// tools) stream their real output entirely through delta.tool_calls, with
// delta.content and delta.reasoning_content empty. totalContentLength in
// createSSEStream() only summed content/reasoning length, so tool-call-only
// turns left it at 0 — which starves both the "estimate from scratch"
// fallback and the zero-completion-with-content fallback, and the provider's
// own completion_tokens: 0 (or absent) usage was logged as-is: out=0, despite
// the client receiving a large tool_calls payload.
import { describe, it, expect, vi } from "vitest";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function sseChunk(obj) {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

async function runPassthroughStream(chunks, { body } = {}) {
  let finalUsage = null;
  let finalContent = null;

  const stream = createSSEStream({
    mode: "passthrough",
    provider: "openai-compatible-chat-test",
    model: "claude-sonnet-5",
    connectionId: "conn-test",
    body: body || { model: "claude-sonnet-5", messages: [{ role: "user", content: "x" }], tools: [] },
    onStreamComplete: (content, usage) => {
      finalContent = content;
      finalUsage = usage;
    },
  });

  const readable = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  const transformed = readable.pipeThrough(stream);
  const reader = transformed.getReader();
  // Drain the output stream so the flush() path (which calls onStreamComplete) runs.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }

  return { finalUsage, finalContent };
}

describe("createSSEStream passthrough — tool-call-only usage tracking", () => {
  it("counts tool_calls argument length toward totalContentLength (no valid usage from provider)", async () => {
    const toolCallChunk = sseChunk({
      id: "chatcmpl-1",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: JSON.stringify({ path: "/a/b.txt" }) },
          }],
        },
      }],
    });
    const finishChunk = sseChunk({
      id: "chatcmpl-1",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      // No usage field at all — provider omitted it entirely (worse than 0).
    });

    const { finalUsage } = await runPassthroughStream([toolCallChunk, finishChunk]);

    expect(finalUsage).not.toBeNull();
    expect(finalUsage.completion_tokens).toBeGreaterThan(0);
    expect(finalUsage.estimated).toBe(true);
  });

  it("patches provider-reported completion_tokens: 0 when output was pure tool_calls (the exact live bug)", async () => {
    const toolCallChunk = sseChunk({
      id: "chatcmpl-2",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_2",
            type: "function",
            function: { name: "edit_file", arguments: JSON.stringify({ path: "/x.js", content: "a".repeat(2000) }) },
          }],
        },
      }],
    });
    const finishChunk = sseChunk({
      id: "chatcmpl-2",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      // Provider-shape from the bug report: real prompt_tokens, completion_tokens: 0.
      usage: { prompt_tokens: 166912, completion_tokens: 0, total_tokens: 166912 },
    });

    const { finalUsage } = await runPassthroughStream([toolCallChunk, finishChunk]);

    expect(finalUsage).not.toBeNull();
    expect(finalUsage.prompt_tokens).toBe(166912); // provider's real input count preserved
    expect(finalUsage.completion_tokens).toBeGreaterThan(0); // no longer stuck at 0
  });

  it("plain text-only responses still work (no regression for the common case)", async () => {
    const textChunk = sseChunk({
      id: "chatcmpl-3",
      choices: [{ index: 0, delta: { content: "Hello world, this is a normal reply." } }],
    });
    const finishChunk = sseChunk({
      id: "chatcmpl-3",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 500, completion_tokens: 10, total_tokens: 510 },
    });

    const { finalUsage } = await runPassthroughStream([textChunk, finishChunk]);

    expect(finalUsage.prompt_tokens).toBe(500);
    expect(finalUsage.completion_tokens).toBe(10); // untouched, was already valid+non-zero
  });
});
