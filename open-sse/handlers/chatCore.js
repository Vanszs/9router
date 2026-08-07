import { compressWithPxpipe, formatPxpipeLog } from "../rtk/pxpipe.js";
import { detectFormat, getTargetFormat, resolveTransport } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import { COLORS } from "../utils/stream.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { extractThinking } from "../translator/concerns/thinkingUnified.js";
import { getModelTargetFormat, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, TOKEN_SAVER_HEADER } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import { supportsGrokCliReasoningEffort } from "../config/grokCli.js";
import { buildRequestDetail, extractRequestConfig } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { buildCoercedSSEResponse } from "./chatCore/coercedSseHandler.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { detectLoop } from "../utils/loopGuard.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { injectDefaultSystemPrompt } from "../rtk/systemInject.js";
import { injectSystemPrompt } from "../rtk/systemInject.js";
import { injectTerminationPrompt, injectToolProtocolPrompt } from "../rtk/terminationPrompt.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../rtk/headroom.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";

const TOOL_PROTOCOL_PROMPT_PROVIDERS = new Set(["kimchi", "nvidia"]);

export function needsTerminationPrompt(provider, model) {
  return /(?:^|[/_-])kimi(?:[/_-]|$)|(?:^|[/_-])kimi-k2\.(?:6|7)(?:\b|[-_/])/i.test(`${provider}/${model}`);
}

export function isNvidiaKimiStreamCoerce(provider, model) {
  return provider === "nvidia" && /kimi-k2\.[67]/i.test(model || "");
}

function extractToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => tool?.function?.name || tool?.name)
    .filter((name) => typeof name === "string" && name.trim());
}

/**
 * Loop guard: detect repeated tool_call patterns in the translated conversation
 * history and, when found, append a stop-and-summarize hint to the last
 * user/tool message so the model breaks out of the loop. Stateless — reads
 * translatedBody.messages only. Idempotent: a hint already present is not
 * re-appended. Returns true when a hint was injected.
 */
export function applyLoopGuard(translatedBody, finalFormat, provider, model, log) {
  const loopCheck = detectLoop(translatedBody);
  if (!loopCheck.detected) return false;
  injectTerminationPrompt(translatedBody, finalFormat);
  const msgs = translatedBody?.messages;
  if (Array.isArray(msgs)) {
    let target = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && (m.role === "user" || m.role === "tool")) {
        target = m;
        break;
      }
      // Text-only loop: last message is assistant (no user/tool after it).
      // Append the hint to the last assistant message so the model sees the
      // correction on its own repeated output.
      if (m && m.role === "assistant" && i === msgs.length - 1) {
        target = m;
        break;
      }
    }
    if (target) {
      const hint = `\n\n[ROUTER NOTE: ${loopCheck.hint}]`;
      if (typeof target.content === "string") {
        if (!target.content.includes("[ROUTER NOTE:")) target.content += hint;
      } else if (Array.isArray(target.content)) {
        if (!target.content.some((p) => p.text && p.text.includes("[ROUTER NOTE:")))
          target.content.push({ type: "text", text: hint });
      } else {
        target.content = hint.trimStart();
      }
    }
  }
  log?.warn?.("LOOPGUARD", `${provider}/${model} | loop detected, hint injected`);
  return true;
}

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent, apiKey, apiKeyInfo = null, apiKeyName = null, ccFilterNaming, rtkEnabled, headroomEnabled, headroomUrl, headroomCompressUserMessages, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, pxpipeEnabled = false, pxpipeMinChars = 1000, pxpipeTimeoutMs = 10000, pxpipeTransform = "png", onPxpipeEvent = null, sourceFormatOverride, providerThinking, clientSignal, loopGuardEnabled = true, systemPrompt = null, clientModelId = null }) {
  const { provider, model, accountCount = 0 } = modelInfo;
  const requestStartTime = Date.now();

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  // Multi-endpoint providers: pick transport matching sourceFormat → zero translation
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const targetFormat = modelTargetFormat || runtimeTransport?.format || getTargetFormat(provider);
  if (runtimeTransport && credentials) credentials.runtimeTransport = runtimeTransport;
  const stripList = getModelStrip(alias, model);
  const upstreamModel = getModelUpstreamId(alias, model);

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  // Gate on model capabilities: skip for non-reasoning models (prevents 400 on GLM-5.1 etc.)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const caps = getCapabilitiesForModel(provider, model);
    if (caps?.reasoning) {
      const mode = providerThinking.mode;
      if (mode === "on" && !body.thinking) {
        body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
      } else if (mode === "off" && !body.thinking) {
        if (caps.thinkingCanDisable !== false) body = { ...body, thinking: { type: "disabled" } };
      } else if (!body.reasoning_effort) {
        body = { ...body, reasoning_effort: mode };
      }
    }
  }

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  // NVIDIA NIM-hosted Kimi-k2.6/k2.7 degrade/empty-response when upstream is asked
  // for streaming. Force upstream stream:false while remembering the client wanted SSE.
  const shouldCoerceStream = isNvidiaKimiStreamCoerce(provider, model) && stream === true;
  const upstreamStream = shouldCoerceStream ? false : stream;
  if (shouldCoerceStream) {
    log?.debug?.("STREAMCOERCE", `${provider}/${model} | stream=true → false (upstream)`);
  }

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli")) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);
  if (detectedTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${model}`);
    }
    // Convert remote image URLs to base64 for targets that can't fetch URLs.
    try {
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, { signal: undefined });
      if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
    } catch (e) { log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`); }
  }

  let translatedBody;
  let toolNameMap;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: upstreamModel };
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, upstreamModel);
  } else {
    translatedBody = translateRequest(sourceFormat, targetFormat, upstreamModel, body, upstreamStream, credentials, provider, reqLogger, stripList, connectionId, clientTool);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    translatedBody.model = upstreamModel;
  }

  // NVIDIA NIM-hosted Kimi-k2.6/k2.7: ensure upstream body also has stream:false
  if (shouldCoerceStream) {
    translatedBody.stream = false;
  }

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // Request line: one correlated summary (fmt + thinking + counts + account)
  if (log?.line) {
    const reqTag = `${provider}/${model}`.slice(0, 20);
    const clientModel = clientRawRequest?.body?.model || `${provider}/${model}`;
    const msgN = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || body.messages?.length || body.input?.length || 0;
    const toolN = translatedBody.tools?.length || body.tools?.length || 0;
    const fmtStr = passthrough ? `FMT: ${sourceFormat} (passthrough)` : `FMT: ${sourceFormat}→${targetFormat}`;
    const showThinking = provider !== "grok-cli" || supportsGrokCliReasoningEffort(model);
    const think = showThinking ? log.fmtThink?.(extractThinking(translatedBody)) : null;
    const acc = credentials?.connectionName || credentials?.connectionId?.slice(0, 8) || "-";
    const parts = [
      `POST ${clientModel} → ${provider}/${model}`,
      fmtStr,
      stream ? "STREAM" : "JSON",
      `${msgN} MSG`,
    ];
    if (toolN) parts.push(`${toolN} TOOL`);
    if (think) parts.push(`THINK:${think}`);
    parts.push(`ACC:${acc}`);
    log.line(reqTag, "▶", parts.join(" · "));
  }

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(msg => msg.role !== "tool");
    delete translatedBody.tools;
  }

  // Per-request opt-out: client can bypass all token savers via header
  const tokenSaverEnabled = clientRawRequest?.headers?.[TOKEN_SAVER_HEADER]?.toLowerCase() !== "off";

  // RTK: compress tool_result content
  const rtkStats = compressMessages(translatedBody, tokenSaverEnabled && rtkEnabled);
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);

  // Headroom: optional external proxy compression; fail open if proxy is absent.
  const headroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(translatedBody, { enabled: tokenSaverEnabled && headroomEnabled, url: headroomUrl, model: upstreamModel, format: finalFormat, compressUserMessages: headroomCompressUserMessages, diagnostics: headroomDiagnostics });
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics);
  if (headroomLine) {
    log?.info?.("HEADROOM", `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`);
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.("HEADROOM", `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${headroomSizeLine}`);
    }
  } else if (tokenSaverEnabled && headroomEnabled) log?.warn?.("HEADROOM", `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`);

  // Default system prompt from settings: inject only when the request does
  // not already carry a system message. Token-saver prompts (caveman/ponytail)
  // below APPEND to it into the same system slot, preserving the default.
  if (systemPrompt) {
    injectDefaultSystemPrompt(translatedBody, finalFormat, systemPrompt);
    log?.debug?.("SYSPROMPT", `default injected | ${finalFormat}`);
  }

  // Caveman: inject terse-style system prompt
  if (tokenSaverEnabled && cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    log?.debug?.("CAVEMAN", `${cavemanLevel} | ${finalFormat}`);
  }

  // Ponytail: inject lazy-senior-dev system prompt
  if (tokenSaverEnabled && ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    log?.debug?.("PONYTAIL", `${ponytailLevel} | ${finalFormat}`);
  }

  if (TOOL_PROTOCOL_PROMPT_PROVIDERS.has(provider)) {
    injectToolProtocolPrompt(translatedBody, finalFormat, extractToolNames(translatedBody.tools));
    log?.debug?.("TOOLPROTO", `${provider}/${model} | ${finalFormat}`);
  }

  if (loopGuardEnabled) {
    applyLoopGuard(translatedBody, finalFormat, provider, model, log);
  }

  if (needsTerminationPrompt(provider, model)) {
    injectTerminationPrompt(translatedBody, finalFormat);
    log?.debug?.("TERMINATION", `${provider}/${model} | ${finalFormat}`);
  }

  // Re-apply provider-level thinking override on the translated body.
  // translateRequest may strip non-standard fields (thinking, reasoning_effort)
  // so we re-inject them here to ensure upstream receives the override.
  // Gate on model capabilities: only inject thinking params for models that
  // actually support reasoning (prevents 400 on non-reasoning models like GLM-5.1).
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const caps = getCapabilitiesForModel(provider, model);
    if (caps?.reasoning) {
      const mode = providerThinking.mode;
      if (mode === "off") {
        translatedBody.reasoning_effort = "none";
        if (caps.thinkingCanDisable !== false) translatedBody.thinking = { type: "disabled" };
        log?.debug?.("THINKING", `${provider}/${model} | disabled`);
      } else if (mode === "on") {
        translatedBody.thinking = { type: "enabled", budget_tokens: 10000 };
        log?.debug?.("THINKING", `${provider}/${model} | enabled (10k budget)`);
      } else {
        translatedBody.reasoning_effort = mode;
        log?.debug?.("THINKING", `${provider}/${model} | effort=${mode}`);
      }
    }
  }

  // PXPIPE: image bulky context (Claude-format bodies only), last saver before dispatch
  let pxpipeSummary = null;
  if (pxpipeEnabled) {
    const pxpipeResult = await compressWithPxpipe(translatedBody, {
      enabled: true, format: finalFormat, model: upstreamModel,
      minChars: pxpipeMinChars, timeoutMs: pxpipeTimeoutMs, transform: pxpipeTransform,
    });
    pxpipeSummary = pxpipeResult.summary;
    if (pxpipeResult.body) translatedBody = pxpipeResult.body;
    const pxpipeLine = formatPxpipeLog(pxpipeSummary);
    if (pxpipeLine) log?.info?.("PXPIPE", pxpipeLine);
    else log?.debug?.("PXPIPE", `skipped: ${pxpipeSummary.reason}${pxpipeSummary.detail ? ` (${pxpipeSummary.detail})` : ""}`);
    try { onPxpipeEvent?.({ provider, model, ...pxpipeSummary }); } catch { /* stats must not break requests */ }
  }

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => { });

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log, provider, model
  });

  // Link the client's disconnect signal to the streamController so in-flight
  // upstream fetches are aborted when the client goes away. Without this, the
  // upstream fetch (which uses streamController.signal) keeps running even after
  // the client disconnects, wasting upstream calls and circuit-breaker probes.
  if (clientSignal) {
    if (clientSignal.aborted) {
      streamController.abort();
    } else {
      clientSignal.addEventListener("abort", () => streamController.abort(), { once: true });
    }
  }

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  // Most executors return their registry format. Cursor AgentService is an
  // exception: it is decoded by the executor into OpenAI-compatible output.
  let providerResponseFormat = targetFormat;
  try {
    const result = await executor.execute({ model, body: translatedBody, stream: upstreamStream, credentials, signal: streamController.signal, log, proxyOptions, accountCount });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    providerResponseFormat = result.responseFormat || targetFormat;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId, apiKey, apiKeyName,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, upstreamStream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error"
    })).catch(() => { });

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (!executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    try {
      // Mutate credentials after each successful refresh: rotating refresh_token
      // providers (xAI/grok-cli) issue a new RT on every refresh; without this,
      // refreshWithRetry's 2nd/3rd attempt reuses the already-consumed RT →
      // invalid_grant → auth_failed retryable=false.
      const newCredentials = await refreshWithRetry(async () => {
        const result = await executor.refreshCredentials(credentials, log);
        if (result?.refreshToken && result.refreshToken !== credentials.refreshToken) {
          if (result.accessToken) credentials.accessToken = result.accessToken;
          credentials.refreshToken = result.refreshToken;
        }
        return result;
      }, 3, log);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try { await onCredentialsRefreshed(newCredentials); } catch (e) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
        }
        try {
          const retryResult = await executor.execute({ model, body: translatedBody, stream: upstreamStream, credentials, signal: streamController.signal, log, proxyOptions, accountCount });
          if (retryResult.response.ok) {
            providerResponse = retryResult.response;
            providerUrl = retryResult.url;
            providerResponseFormat = retryResult.responseFormat || targetFormat;
          }
        } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId, apiKey, apiKeyName,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, upstreamStream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status: statusCode, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error"
    })).catch(() => { });

    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    console.log(`${COLORS.red}[ERROR] ${errMsg}${COLORS.reset}`);
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, apiKeyInfo, apiKeyName, clientRawRequest, onRequestSuccess, pxpipe: pxpipeSummary };
  const appendLog = (extra) => appendRequestLog({ model, provider, connectionId, ...extra }).catch(() => { });
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  // NVIDIA Kimi: upstream was coerced to non-streaming, convert response back to SSE
  if (shouldCoerceStream && clientRequestedStreaming) {
    const result = await handleNonStreamingResponse({ ...sharedCtx, stream: upstreamStream, providerResponse, sourceFormat, targetFormat, reqLogger, toolNameMap, trackDone, appendLog });
    if (!result.success) return result;
    const jsonBody = await result.response.json();
    const sseResponse = buildCoercedSSEResponse(jsonBody);
    streamController.handleComplete();
    return { success: true, response: sseResponse };
  }

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, toolNameMap, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }
  }

  // True non-streaming response
  if (!stream) {
    let result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat || targetFormat, reqLogger, toolNameMap, trackDone, appendLog });

    // ClinePass sometimes returns {success:false, error:"empty response content"} transiently
    if (provider === "clinepass" && !result?.success && /empty/i.test(result?.error || "")) {
      log?.warn?.("RETRY", `clinepass returned empty content, retrying once after 2s`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        const retry = await executor.execute({ model, body: translatedBody, stream: false, credentials, signal: streamController.signal, log, proxyOptions });
        if (retry?.response?.ok) {
          providerResponse = retry.response;
          result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat || targetFormat, reqLogger, toolNameMap, trackDone, appendLog });
        }
      } catch (retryErr) {
        log?.warn?.("RETRY", `clinepass retry failed: ${retryErr.message}`);
      }
    }

    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({ ...sharedCtx });
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat: providerResponseFormat || targetFormat, userAgent, reqLogger, toolNameMap, streamController, onStreamComplete, streamDetailId, pxpipe: pxpipeSummary });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
