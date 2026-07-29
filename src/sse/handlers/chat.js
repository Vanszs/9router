import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
  isProviderAllowed,
  isComboAllowed,
  isKindAllowed,
  isTrustedInternalRequest,
} from "../services/auth.js";
import { checkApiKeyLimits, recordApiKeyUsage } from "@/lib/db/repos/apiKeyUsageRepo.js";
import {
  isKimchiQuotaExhausted,
  buildKimchiQuotaExhaustedUpdate,
  detectDailyQuotaExhaustion,
  buildDailyQuotaLockUpdate,
  isProviderInCooldown,
  isProviderFullyBlocked,
  getProviderShortestCooldownMs,
  recordProviderFailure,
  clearProviderFailure,
} from "open-sse/services/accountFallback.js";
import {
  acquire as acquireAccountSemaphore,
  resolveAccountSemaphoreKey,
  resolveAccountSemaphoreMaxConcurrency,
  isSemaphoreCapacityError,
} from "open-sse/services/accountSemaphore.js";
import { getProxyHash } from "@/lib/network/connectionProxy.js";
import { updateProviderConnection, getProviderConnections } from "@/lib/localDb";
import { isModelAllowed } from "../services/allowedModels.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { errorResponse, unavailableResponse, withSelectedConnectionHeader } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat } from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { maybeWaitForCooldown, MAX_COOLDOWN_RETRIES } from "open-sse/utils/cooldownRetry.js";

function checkCircuitBreaker(provider, proxyHash = null, enabled = true) {
  if (!enabled) return false;
  return proxyHash ? isProviderInCooldown(provider, proxyHash) : isProviderFullyBlocked(provider);
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Accept header negotiation: curl/httpx send Accept: text/event-stream to
  // indicate they want SSE. If the client did so WITHOUT an explicit
  // stream:false in the body, treat it as stream=true. Do NOT override an
  // explicit stream=false — the OpenAI Python SDK sends Accept:
  // text/event-stream even for non-streaming calls.
  const acceptHeader = request.headers.get("accept") || "";
  if (acceptHeader.includes("text/event-stream") && body.stream === undefined) {
    body.stream = true;
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support both messages[] and input[] formats)
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`);

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  let apiKeyInfo = null;
  // Trusted internal (dashboard/CLI) requests act as the local owner — bypass ACL.
  const trustedInternal = await isTrustedInternalRequest(request);
  if (!trustedInternal && settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    apiKeyInfo = await isValidApiKey(apiKey);
    if (!apiKeyInfo) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  // Enforce per-key usage limits (applies even when requireApiKey is false but a key was supplied)
  if (apiKeyInfo) {
    const estimatedTokens = body.max_tokens || 0;
    const limitCheck = checkApiKeyLimits(apiKeyInfo, estimatedTokens);
    if (!limitCheck.allowed) {
      log.warn("AUTH", `API key limit exceeded: ${limitCheck.reason}`);
      const retryAfter = limitCheck.retryAfterMs ? Math.ceil(limitCheck.retryAfterMs / 1000).toString() : undefined;
      const body = JSON.stringify({
        error: { message: limitCheck.reason, type: "rate_limit_error", code: "rate_limit_exceeded" },
      });
      return new Response(body, {
        status: HTTP_STATUS.RATE_LIMITED,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          ...(retryAfter ? { "Retry-After": retryAfter } : {}),
        },
      });
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // ACL: check if LLM kind is allowed for this API key
  if (!isKindAllowed(apiKeyInfo, "llm")) {
    log.warn("AUTH", "LLM kind not allowed for API key");
    return errorResponse(HTTP_STATUS.FORBIDDEN, "Chat/LLM requests are not allowed for this API key");
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // ACL: check if this combo is allowed for this API key
    if (!isComboAllowed(apiKeyInfo, modelStr)) {
      log.warn("AUTH", `Combo "${modelStr}" not allowed for API key`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, `Combo "${modelStr}" is not allowed for this API key`);
    }
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, apiKeyInfo);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m, opts) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, apiKeyInfo, opts),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
      signal: request?.signal ?? null,
      timeoutMs: comboStrategies[modelStr]?.targetTimeoutMs ?? null,
      queueDepth: comboStrategies[modelStr]?.queueDepth ?? null,
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, apiKeyInfo);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, apiKeyInfo = null, options = null) {
  const externalSignal = options?.signal ?? null;
  const clientSignal = request?.signal && externalSignal
    ? AbortSignal.any([request.signal, externalSignal])
    : (request?.signal || externalSignal || null);
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, apiKeyInfo);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, opts) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, apiKeyInfo, opts),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        signal: request?.signal ?? null,
        timeoutMs: comboStrategies[modelStr]?.targetTimeoutMs ?? null,
        queueDepth: comboStrategies[modelStr]?.queueDepth ?? null,
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // ACL: check if provider is allowed for this API key
  if (!(await isProviderAllowed(apiKeyInfo, provider))) {
    log.warn("AUTH", `Provider "${provider}" not allowed for API key`, { provider });
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider "${provider}" is not allowed for this API key`);
  }

  // ACL: check if model is in available models list
  const resolvedModelStr = `${provider}/${model}`;
  const isAllowed = (modelStr === resolvedModelStr)
    ? await isModelAllowed(resolvedModelStr, apiKeyInfo)
    : (await isModelAllowed(modelStr, apiKeyInfo) || await isModelAllowed(resolvedModelStr, apiKeyInfo));
  if (!isAllowed) {
    log.warn("CHAT", `Model not in available models list`, { model: resolvedModelStr });
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Model "${resolvedModelStr}" is not available. Only models listed in /v1/models can be used.`);
  }

  // Log model routing (alias → actual model)
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  const chatSettings = await getSettings();
  const circuitBreakerEnabled = chatSettings.circuitBreakerEnabled !== false && chatSettings.circuitBreakerEnabled !== 0;

  // Pipeline gate: check circuit breaker state BEFORE credential lookup.
  // If ALL proxy buckets for this provider are OPEN, short-circuit immediately
  // — no point querying the DB when every bucket is blocked.
  if (checkCircuitBreaker(provider, null, circuitBreakerEnabled)) {
    const cooldownMs = getProviderShortestCooldownMs(provider);
    const retryAfterSec = Math.ceil(cooldownMs / 1000) || 30;
    const retryAfterTimestamp = new Date(Date.now() + cooldownMs).toISOString();
    log.warn("GATE", `${provider} circuit breaker OPEN on all proxy buckets — short-circuiting before credential lookup`);
    return withSelectedConnectionHeader(
      unavailableResponse(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        `[${provider}/${model}] Provider temporarily unavailable (circuit breaker open)`,
        retryAfterTimestamp,
        `${retryAfterSec}s`
      ),
      null
    );
  }

  // Count configured accounts for this provider so chatCore can cap per-account
  // retries: more accounts → fail faster and fall back to the next account.
  let providerAccountCount = 0;
  try {
    const allProviderConnections = await getProviderConnections({ provider });
    providerAccountCount = allProviderConnections?.length || 0;
  } catch (e) {
    log?.warn?.("AUTH", `Failed to count provider connections for ${provider}: ${e.message}`);
  }

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastExcludedConnectionId = null;
  // Bug #3758: per-request counter bounding the early-close (STREAM_EARLY_EOF)
  // re-attempt to exactly one for the whole request. Declared outside the
  // credential retry loop so it can never reset and loop.
  let streamEarlyEofRetries = 0;
  // Cooldown-aware retry: when ALL accounts are rate-limited with a near-term
  // retryAfter, wait briefly (<=30s) and retry the whole credential loop once
  // instead of immediately returning 503. Bounded to 1 retry per request.
  let cooldownRetries = 0;

  while (true) {
    // Abort check: stop trying accounts if the client already disconnected.
    // Prevents wasted upstream calls and circuit-breaker probe hits on a dead
    // connection.
    if (request?.signal?.aborted) {
      log.info("CHAT", `[${provider}/${model}] client disconnected — aborting fallback loop`);
      return withSelectedConnectionHeader(new Response(null, { status: 499 }), lastExcludedConnectionId);
    }

    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        // Cooldown-aware retry: if the earliest account comes off cooldown soon,
        // wait for it (aborted on client disconnect) then retry once.
        if (credentials.retryAfter && cooldownRetries < MAX_COOLDOWN_RETRIES) {
          const waitDecision = await maybeWaitForCooldown({
            retryAfter: credentials.retryAfter,
            retriesSoFar: cooldownRetries,
            signal: request?.signal,
          });
          if (waitDecision.shouldRetry) {
            cooldownRetries++;
            log.info("CHAT", `[${provider}/${model}] all accounts rate-limited — waited ${waitDecision.waitedMs}ms, retrying (attempt ${cooldownRetries})`);
            // Re-enter the loop WITHOUT excluding accounts — they may be usable now.
            continue;
          }
          if (waitDecision.reason === "client_disconnected") {
            log.info("CHAT", `[${provider}/${model}] client disconnected during cooldown wait — aborting`);
            // Return a minimal response; client is gone anyway.
            return withSelectedConnectionHeader(new Response(null, { status: 499 }), credentials?.connectionId ?? null);
          }
          log.info("CHAT", `[${provider}/${model}] cooldown retry skipped: ${waitDecision.reason}`);
        }
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return withSelectedConnectionHeader(
          unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman),
          credentials?.connectionId ?? null
        );
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return withSelectedConnectionHeader(
          errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`),
          credentials?.connectionId ?? null
        );
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return withSelectedConnectionHeader(
        errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable"),
        lastExcludedConnectionId
      );
    }

    // Compute proxy bucket key for this account — groups accounts by shared proxy.
    // Uses the original credentials: proxy config (connectionProxyUrl/proxyPoolId)
    // is a connection-level field that does not change on token refresh, and
    // refreshedCredentials is not assigned until after this circuit-breaker gate.
    const proxyHash = getProxyHash(credentials.providerSpecificData);

    // Proxy-aware circuit breaker: skip THIS account if its proxy bucket is OPEN.
    // Accounts on other proxies are still tried.
    if (checkCircuitBreaker(provider, proxyHash, circuitBreakerEnabled)) {
      log.warn("AUTH", `${provider} proxy bucket ${proxyHash} circuit breaker OPEN — skipping account ${credentials.connectionName}`);
      excludeConnectionIds.add(credentials.connectionId);
      lastExcludedConnectionId = credentials.connectionId;
      continue;
    }

    // Log account selection
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Acquire account semaphore (concurrency limiter per provider:account:proxy)
    const semaphoreKey = resolveAccountSemaphoreKey({ provider, model, connectionId: credentials.connectionId, credentials: refreshedCredentials, proxyHash });
    const semaphoreMax = resolveAccountSemaphoreMaxConcurrency(refreshedCredentials);
    const semaphoreEnabled = chatSettings.semaphoreEnabled !== false && chatSettings.semaphoreEnabled !== 0;
    let semaphoreRelease = () => {};
    if (semaphoreEnabled && semaphoreKey && semaphoreMax != null) {
      try {
        const semaphoreOptions = { maxConcurrency: semaphoreMax, timeoutMs: 30_000 };
        if (options?.maxQueueSize != null) {
          semaphoreOptions.maxQueueSize = options.maxQueueSize;
        }
        semaphoreRelease = await acquireAccountSemaphore(semaphoreKey, semaphoreOptions);
      } catch (e) {
        if (isSemaphoreCapacityError(e)) {
          log.warn("AUTH", `Account ${credentials.connectionName} at capacity, trying fallback`);
          excludeConnectionIds.add(credentials.connectionId);
          continue;
        }
        throw e;
      }
    }

    // Use shared chatCore — wrap in try/finally so semaphoreRelease() always runs
    let result;
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    try {
      result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model, accountCount: providerAccountCount },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      apiKeyName: apiKeyInfo?.name || null,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      loopGuardEnabled: chatSettings.loopGuardEnabled !== false && chatSettings.loopGuardEnabled !== 0,
      providerThinking,
      clientSignal,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        clearProviderFailure(provider, proxyHash);
      },
      apiKeyInfo
    });
    } finally {
      // Always release the semaphore slot, even if handleChatCore throws
      semaphoreRelease();
    }

    if (result.success) return withSelectedConnectionHeader(result.response, credentials.connectionId); // sets X-VansRoute-Selected-Connection-Id

    // STREAM_EARLY_EOF: flaky upstream sent HTTP 200 then closed the SSE before
    // any useful content frame. Transient upstream glitch — retry once on the
    // SAME connection without marking it unavailable. The finally block above
    // already released the semaphore slot; the loop will re-acquire on re-entry.
    if (result.errorCode === "STREAM_EARLY_EOF" && streamEarlyEofRetries < 1) {
      streamEarlyEofRetries++;
      log.warn("STREAM", `${provider}/${model} closed stream before useful content — retrying once (attempt ${streamEarlyEofRetries})`);
      continue;
    }

    // Normalize result.error to a string before passing to pattern matchers.
    // Some upstream paths may return an Error instance; JSON.stringify(new Error())
    // yields "{}" and breaks keyword matching in quota detectors.
    const errorText = result.error?.message || result.error;

    // Kimchi quota exhausted: deactivate the account until the 1st of next month.
    if (isKimchiQuotaExhausted(provider, errorText)) {
      try {
        const update = buildKimchiQuotaExhaustedUpdate();
        await updateProviderConnection(credentials.connectionId, update);
        log.warn("AUTH", `Kimchi quota exhausted: deactivated ${credentials.connectionName || credentials.connectionId} until ${update.rateLimitedUntil}`);
      } catch (e) {
        log.error("AUTH", `Failed to deactivate Kimchi account on quota exhausted: ${e.message}`);
      }
      // Fall through to fallback behavior — the next account or provider will be tried.
    }

    // Generalized daily quota detection (non-Kimchi): when a 429 error body
    const dailyQuota = detectDailyQuotaExhaustion(provider, errorText);
    if (dailyQuota && result.status === 429) {
      try {
        const lockUpdate = buildDailyQuotaLockUpdate(model);
        await updateProviderConnection(credentials.connectionId, lockUpdate);
        log.warn("AUTH", `Daily quota exhausted: locked model ${model} on ${credentials.connectionName || credentials.connectionId} until tomorrow 00:00 UTC`);
      } catch (e) {
        log.error("AUTH", `Failed to lock model on daily quota exhaustion: ${e.message}`);
      }
      // Fall through to fallback behavior — the next account will be tried.
    }

    // Mark account unavailable (auto-calculates cooldown with classify429 for 429s, exponential backoff, or precise resetsAtMs)
    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, errorText, provider, model, result.resetsAtMs);

    // Record provider-level failure for circuit breaker — skip if it's a known
    // Kimchi quota-exhaustion (not a provider-wide outage). Proxy-aware: failure
    // is attributed to the specific proxy bucket.
    if (!isKimchiQuotaExhausted(provider, errorText)) {
      recordProviderFailure(provider, result.status, errorText, log, credentials.connectionId, proxyHash);
    }

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = errorText;
      lastStatus = result.status;
      continue;
    }

    return withSelectedConnectionHeader(result.response, credentials.connectionId); // sets X-VansRoute-Selected-Connection-Id
  }
}
