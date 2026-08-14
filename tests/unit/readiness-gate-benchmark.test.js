// Benchmark: how long does the streaming readiness gate delay the client?
// The gate (peekStreamReadiness in streamingHandler.js) awaits the FIRST
// upstream chunk before returning the Response, so the client's HTTP 200 +
// SSE headers are delayed by the full upstream TTFT. This test measures that
// resolve time so we can diff before/after the time-box optimization.
//
// Run individually: npx vitest run -c tests/vitest.config.js tests/unit/readiness-gate-benchmark.test.js
import { describe, it, expect } from "vitest";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { STREAM_READINESS_PEEK_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";

// A ReadableStream whose first byte arrives only after `delayMs`.
function delayedFirstChunkStream(delayMs, chunk = new TextEncoder().encode('data: {"id":"x","object":"chat.completion","created":0,"model":"glm-5.2","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n')) {
  let enqueued = false;
  return new ReadableStream({
    async pull(controller) {
      if (enqueued) { controller.close(); return; }
      enqueued = true;
      await new Promise((r) => setTimeout(r, delayMs));
      controller.enqueue(chunk);
    }
  });
}

function makeController() {
  return createStreamController({ onDisconnect: () => {}, onError: () => {}, provider: "agentrouter", model: "glm-5.2" });
}

const baseCtx = {
  provider: "agentrouter",
  model: "glm-5.2",
  sourceFormat: "claude",
  targetFormat: "openai",
  userAgent: "test",
  body: { messages: [{ role: "user", content: "hi" }] },
  stream: true,
  translatedBody: null,
  finalBody: null,
  requestStartTime: Date.now(),
  connectionId: "conn-1",
  apiKey: "sk-test",
  apiKeyName: "test-key",
  clientRawRequest: null,
  onRequestSuccess: null,
  reqLogger: null,
  toolNameMap: new Map(),
  onStreamComplete: () => {}
};

describe("readiness gate — time-to-headers benchmark", () => {
  it("resolves Response only after first upstream byte (baseline measurement)", async () => {
    const firstChunkDelayMs = 1200;
    const providerResponse = new Response(delayedFirstChunkStream(firstChunkDelayMs), {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });

    const t0 = Date.now();
    const result = await handleStreamingResponse({
      ...baseCtx,
      providerResponse,
      streamController: makeController()
    });
    const resolveMs = Date.now() - t0;

    // eslint-disable-next-line no-console
    console.log(`[BENCH] first-chunk delay=${firstChunkDelayMs}ms | gate resolve (time-to-headers)=${resolveMs}ms | bound=${STREAM_READINESS_PEEK_TIMEOUT_MS}ms`);

    expect(result.success).toBe(true);
    // The gate must not add MORE than the configured peek bound on top of the
    // upstream TTFT for the client headers. Without a time-box, resolveMs ≈
    // firstChunkDelayMs. With the time-box it must resolve by the bound.
    expect(resolveMs).toBeLessThanOrEqual(firstChunkDelayMs + 50);
    expect(resolveMs).toBeLessThanOrEqual(STREAM_READINESS_PEEK_TIMEOUT_MS + 100);

    // Consume the timed-out body end-to-end — guards against a concurrent
    // reader.read() TypeError on the in-flight peek read.
    const chunks = [];
    for await (const chunk of result.response.body) chunks.push(chunk);
    const all = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString();
    expect(all).toContain("hi");
  });

  it("still detects STREAM_EARLY_EOF for an instant-close stream", async () => {
    const providerResponse = new Response(new ReadableStream({ pull(c) { c.close(); } }), {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
    const result = await handleStreamingResponse({
      ...baseCtx,
      providerResponse,
      streamController: makeController()
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("STREAM_EARLY_EOF");
    expect(result.status).toBe(502);
  });
});
