import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { normalizeKimiToolCalls } from "../../utils/kimiToolParser.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";

const STREAM_EARLY_EOF_STATUS = 502;

/**
 * Peek the first chunk of a ReadableStream to detect early EOF.
 * If the stream closes before any byte arrives, return { empty: true }.
 * Otherwise return the first chunk + the reader so the caller can
 * reconstruct a stream that still contains that first chunk.
 */
async function peekStreamReadiness(body) {
  if (!body || typeof body.getReader !== "function") {
    return { empty: true };
  }
  const reader = body.getReader();
  try {
    const { done, value } = await reader.read();
    if (done) {
      return { empty: true };
    }
    return { empty: false, firstChunk: value, reader };
  } catch (error) {
    reader.cancel?.().catch(() => {});
    throw error;
  }
}

/**
 * Reconstruct a ReadableStream from a peeked first chunk + remaining reader.
 */
function reconstructStream({ firstChunk, reader }) {
  let enqueuedFirst = false;
  return new ReadableStream({
    async pull(controller) {
      if (!enqueuedFirst) {
        controller.enqueue(firstChunk);
        enqueuedFirst = true;
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          reader.releaseLock?.();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        reader.cancel?.().catch(() => {});
      }
    },
    cancel(reason) {
      reader.cancel?.(reason).catch(() => {});
    }
  });
}

// Codex returns Responses API SSE → which client format to translate INTO, by request sourceFormat.
// Gemini-family all map to ANTIGRAVITY decoder; unknown sources fall back to OPENAI.
const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY,
};

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;
  const isKimiModel = /kimi-k2\./i.test(model || "");

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, isKimiModel ? normalizeKimiToolCalls : null);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, isKimiModel ? normalizeKimiToolCalls : null);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, isKimiModel ? normalizeKimiToolCalls : null);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 * Includes a readiness gate: if upstream closes before any byte arrives,
 * return STREAM_EARLY_EOF so the caller can retry once on the same connection.
 */
export async function handleStreamingResponse({
  providerResponse, provider, model, sourceFormat, targetFormat, userAgent,
  body, stream, translatedBody, finalBody, requestStartTime, connectionId,
  apiKey, apiKeyInfo, apiKeyName, clientRawRequest, onRequestSuccess,
  reqLogger, toolNameMap, streamController, onStreamComplete, streamDetailId, pxpipe,
}) {
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  // Warn when upstream returns unexpected Content-Type for a streaming response.
  // This often means the provider returned an HTML error page or plain-text error
  // that the SSE transform stream would forward as garbage to the client.
  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    console.warn('[STREAM] ' + provider + ' | ' + model + ' | unexpected Content-Type: ' + upstreamContentType);
  }

  // Readiness gate: peek the first chunk before committing to the streaming
  // response. If upstream closes before any byte arrives, signal STREAM_EARLY_EOF
  // so chat.js can retry once on the same connection without marking it down.
  let peek;
  try {
    peek = await peekStreamReadiness(providerResponse.body);
  } catch (error) {
    return {
      success: false,
      status: 502,
      errorCode: "STREAM_EARLY_EOF",
      error: error?.message || String(error)
    };
  }

  if (peek.empty) {
    return {
      success: false,
      status: STREAM_EARLY_EOF_STATUS,
      errorCode: "STREAM_EARLY_EOF",
      error: "Upstream closed stream before any useful content"
    };
  }

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey });

  // Responses passthrough: synthesize response.failed + [DONE] if the stream aborts/stalls before a terminal event
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough ? buildAbortedResponsesTerminalBytes : null;
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const reconstructedResponse = new Response(reconstructStream(peek), {
    status: providerResponse.status,
    statusText: providerResponse.statusText,
    headers: providerResponse.headers
  });
  const transformedBody = pipeWithDisconnect(reconstructedResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs);

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId, apiKey, apiKeyName,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    pxpipe,
    status: "success"
  }, { id: streamDetailId })).catch(err => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, apiKeyInfo, apiKeyName, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, pxpipe }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId, apiKey, apiKeyName,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      pxpipe,
      status: "success"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, apiKeyInfo, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE" });
  };

  return { onStreamComplete, streamDetailId };
}
