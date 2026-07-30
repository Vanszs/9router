import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { normalizeKimiToolCalls } from "../../utils/kimiToolParser.js";
import { addBufferToUsage, filterUsageForFormat } from "../../utils/usageTracking.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { unwrapClinepassEnvelope } from "../../utils/clinepassEnvelope.js";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats } from "./requestDetail.js";
import { appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { extractToolNames } from "../../translator/concerns/toolCall.js";

/**
 * Convert OpenAI chat.completion response to Claude message format.
 * Used when client sent Claude-format request but upstream returned OpenAI format
 * (e.g. relayn provider where request was translated CLAUDE→OPENAI upstream).
 */
export function openaiToClaudeNonStreaming(openaiBody, model) {
  if (!openaiBody?.choices?.[0]) return openaiBody;

  const choice = openaiBody.choices[0];
  const message = choice.message || {};
  const text = message.content || "";
  const reasoning = message.reasoning_content || "";
  const toolCalls = message.tool_calls || [];

  // Build Claude content array
  const content = [];
  if (reasoning) {
    content.push({ type: "thinking", thinking: reasoning });
  }
  if (text) {
    content.push({ type: "text", text });
  }
  for (const tc of toolCalls) {
    let args = {};
    try {
      args = JSON.parse(tc.function?.arguments || "{}");
    } catch {}
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function?.name || "",
      input: args
    });
  }

  // Map finish reason
  let stopReason = choice.finish_reason;
  if (stopReason === "stop") stopReason = "end_turn";
  else if (stopReason === "tool_calls") stopReason = "tool_use";

  // Map usage
  const usage = openaiBody.usage || {};
  const claudeUsage = {};
  if (usage.prompt_tokens != null) {
    claudeUsage.input_tokens = usage.prompt_tokens;
    claudeUsage.output_tokens = usage.completion_tokens || 0;
    if (usage.prompt_tokens_details?.cached_tokens) {
      claudeUsage.cache_read_input_tokens = usage.prompt_tokens_details.cached_tokens;
    }
    if (usage.completion_tokens_details?.reasoning_tokens) {
      claudeUsage.output_tokens = (usage.completion_tokens || 0) + usage.completion_tokens_details.reasoning_tokens;
    }
  }

  return {
    id: `msg_${(openaiBody.id || "").replace("chatcmpl-", "") || Date.now()}`,
    type: "message",
    role: "assistant",
    content,
    model: model || openaiBody.model || "claude",
    stop_reason: stopReason,
    stop_sequence: null,
    usage: claudeUsage
  };
}

/**
 * Translate non-streaming response body from provider format → OpenAI format.
 */
export function translateNonStreamingResponse(responseBody, targetFormat, sourceFormat) {
  if (targetFormat === sourceFormat || targetFormat === FORMATS.OPENAI) return responseBody;

  // Gemini / Antigravity
  if (targetFormat === FORMATS.GEMINI || targetFormat === FORMATS.ANTIGRAVITY || targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.VERTEX) {
    const response = responseBody.response || responseBody;
    if (!response?.candidates?.[0]) return responseBody;

    const candidate = response.candidates[0];
    const content = candidate.content;
    const usage = response.usageMetadata || responseBody.usageMetadata;
    let textContent = "", reasoningContent = "";
    const toolCalls = [];

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.thought === true && part.text) reasoningContent += part.text;
        else if (part.text !== undefined) textContent += part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`,
            type: "function",
            function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) }
          });
        }
        // Handle inline image data (from image generation models)
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
          textContent += `\n![image](data:${mimeType};base64,${inlineData.data})\n`;
        }
      }
    }

    const message = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (reasoningContent) message.reasoning_content = reasoningContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = (candidate.finishReason || "stop").toLowerCase();
    if (finishReason === "stop" && toolCalls.length > 0) finishReason = "tool_calls";

    const result = {
      id: `chatcmpl-${response.responseId || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(new Date(response.createTime || Date.now()).getTime() / 1000),
      model: response.modelVersion || "gemini",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (usage) {
      result.usage = {
        prompt_tokens: (usage.promptTokenCount || 0) + (usage.thoughtsTokenCount || 0),
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
      };
      if (usage.thoughtsTokenCount > 0) {
        result.usage.completion_tokens_details = { reasoning_tokens: usage.thoughtsTokenCount };
      }
    }
    return result;
  }

  // Claude
  if (targetFormat === FORMATS.CLAUDE) {
    // Always translate a Claude-format body to OpenAI, even if `content` is
    // missing/null (e.g. M3 with max_tokens:1 spends the budget on thinking
    // and returns `content: null`). Returning the raw body would leave the
    // OpenAI client without a `choices` array and surface as a UI test error.
    // Early return if the response is already in OpenAI format (has choices array)
    // or if it has content as a non-array value (likely a different non-Claude format).
    // Some providers (e.g. xiaomi-tokenplan) return OpenAI-format responses even when
    // the request was translated to Claude format — the targetFormat is Claude but the
    // actual response is OpenAI-native and needs no further translation.
    if (responseBody.choices || (responseBody.content && !Array.isArray(responseBody.content))) return responseBody;

    let textContent = "", thinkingContent = "";
    const toolCalls = [];

    for (const block of (responseBody.content || [])) {
      if (block.type === "text") {
        // Strip markdown code block markers (e.g. kimi wraps JSON in ```json...```)
        const raw = block.text ?? "";
        const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        textContent += text;
      } else if (block.type === "thinking") thinkingContent += block.thinking || "";
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
      }
    }

    const message = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (thinkingContent) message.reasoning_content = thinkingContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = responseBody.stop_reason || "stop";
    if (finishReason === "end_turn") finishReason = "stop";
    if (finishReason === "tool_use") finishReason = "tool_calls";

    const result = {
      id: `chatcmpl-${responseBody.id || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: responseBody.model || "claude",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (responseBody.usage) {
      result.usage = {
        prompt_tokens: responseBody.usage.prompt_tokens || responseBody.usage.input_tokens || 0,
        completion_tokens: responseBody.usage.completion_tokens || responseBody.usage.output_tokens || 0,
        total_tokens: responseBody.usage.total_tokens ||
          ((responseBody.usage.prompt_tokens || responseBody.usage.input_tokens || 0) +
           (responseBody.usage.completion_tokens || responseBody.usage.output_tokens || 0))
      };
      if (responseBody.usage.completion_tokens_details) {
        result.usage.completion_tokens_details = responseBody.usage.completion_tokens_details;
      }
    }
    return result;
  }

  // Ollama
  if (targetFormat === FORMATS.OLLAMA) {
    return ollamaBodyToOpenAI(responseBody);
  }

  return responseBody;
}

/**
 * Handle non-streaming response from provider.
 */
  export async function handleNonStreamingResponse({ providerResponse, provider, model, clientModelId, sourceFormat, targetFormat, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, apiKeyInfo, apiKeyName, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, trackDone, appendLog, pxpipe, comboName }) {
  trackDone();
  const contentType = providerResponse.headers.get("content-type") || "";
  let responseBody;

  if (contentType.includes("text/event-stream")) {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model, extractToolNames(body?.tools));
    if (!parsed) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    }
    responseBody = parsed;
  } else {
    try {
      responseBody = await providerResponse.json();
    } catch (err) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      console.error(`[ChatCore] Failed to parse JSON from ${provider}:`, err.message);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
    }
  }

  reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  // Unwrap ClinePass {success, data} envelope before decloak/translation
  {
    const { body: unwrapped, error: envError } = unwrapClinepassEnvelope(responseBody, provider);
    if (envError) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, envError.message);
    }
    responseBody = unwrapped;
  }

  // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
  responseBody = decloakToolNames(responseBody, toolNameMap);

  const usage = extractUsageFromResponse(responseBody);
  appendLog({ tokens: usage, status: "200 OK" });
  saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, apiKeyInfo, endpoint: clientRawRequest?.endpoint, comboName });

  const translatedResponse = needsTranslation(targetFormat, sourceFormat)
    ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat)
    : responseBody;

  // Reverse translation: provider format → Claude when client sent Claude format.
  // After translateNonStreamingResponse the body is always in OpenAI shape,
  // so openaiToClaudeNonStreaming works for any non-Claude target provider.
  let didReverse = false;
  let finalResponse = translatedResponse;
  if (sourceFormat === FORMATS.CLAUDE && targetFormat !== FORMATS.CLAUDE) {
    const reversed = openaiToClaudeNonStreaming(translatedResponse, model);
    finalResponse = decloakToolNames(reversed, toolNameMap);
    didReverse = true;
  }

  // Only apply OpenAI-specific post-processing when response is still in OpenAI format
  if (!didReverse) {
    // Native Kimi tool-call markup sometimes leaks into `content` instead of being
    // returned as a structured `tool_calls` array (see .docs/audit/KIMI-WEIRD-OUTPUTS.md).
    // Convert it for Kimi-family models before the finish_reason fixup.
    const isKimiModel = /kimi-k2\./i.test(model || "");
    if (isKimiModel && Array.isArray(translatedResponse?.choices)) {
      for (const choice of translatedResponse.choices) {
        const msg = choice?.message;
        if (!msg || msg.role !== "assistant") continue;
        const { message: normalized, hasTools } = normalizeKimiToolCalls(msg);
        if (hasTools) {
          choice.message = normalized;
        }
      }
    }

    // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
    if (translatedResponse?.choices?.[0]) {
      const choice = translatedResponse.choices[0];
      const msg = choice.message;
      const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
      if (hasToolCalls && choice.finish_reason !== "tool_calls") {
        choice.finish_reason = "tool_calls";
      }
    }

    // Ensure OpenAI-required fields
    if (!translatedResponse.object) translatedResponse.object = "chat.completion";
    if (!translatedResponse.created) translatedResponse.created = Math.floor(Date.now() / 1000);

    // Strip Azure-specific fields
    delete translatedResponse.prompt_filter_results;
    if (translatedResponse?.choices) {
      for (const choice of translatedResponse.choices) delete choice.content_filter_results;
    }

    if (translatedResponse?.usage) {
      translatedResponse.usage = filterUsageForFormat(addBufferToUsage(translatedResponse.usage), sourceFormat);
    }

    // Keep reasoning_content even when content is non-empty.
    // NVIDIA NIM / DeepSeek / Kimi / Qwen return both the chain-of-thought and the
    // final answer; stripping reasoning here made the Thinking control look like a
    // no-op (200 OK, but no visible reasoning). Clients that do not want reasoning
    // can ignore the field.
  }

  reqLogger.logConvertedResponse(finalResponse);

  const totalLatency = Date.now() - requestStartTime;
  // Extract response fields compatible with both OpenAI and Claude formats
  const respContent = finalResponse?.choices?.[0]?.message?.content
    || (Array.isArray(finalResponse?.content)
      ? (finalResponse.content.find(b => b.type === "text")?.text || "")
      : null)
    || "";
  const respThinking = finalResponse?.choices?.[0]?.message?.reasoning_content
    || (Array.isArray(finalResponse?.content)
      ? finalResponse.content.find(b => b.type === "thinking")?.thinking
      : null)
    || null;
  const respFinish = finalResponse?.choices?.[0]?.finish_reason
    || finalResponse?.stop_reason
    || "unknown";

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId, apiKey, apiKeyName,
    latency: { ttft: totalLatency, total: totalLatency },
    tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: responseBody || null,
    response: {
      content: respContent,
      thinking: respThinking,
      finish_reason: respFinish
    },
    pxpipe,
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save:", err.message);
  });

  // Echo the client-facing model id (original alias or provider/model string)
  // rather than the upstream provider's modelVersion. ponytail: overwrite only
  // when clientModelId is present; otherwise the translator's value stands.
  if (clientModelId && finalResponse && typeof finalResponse === "object" && !Array.isArray(finalResponse)) {
    finalResponse.model = clientModelId;
  }

  return {
    success: true,
    response: new Response(JSON.stringify(finalResponse), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  };
}
