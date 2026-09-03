import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings, getProviderNodeById, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { classify429 } from "open-sse/utils/classify429.js";
import { resolveAntigravityProxyConfig } from "open-sse/utils/proxyFetch.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS, AI_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers.js";
import { getAntigravityQuotaCache } from "./antigravityQuota.js";
import * as log from "../utils/logger.js";

// Re-export the internal-trust gate so handlers can import it alongside the
// other ACL helpers. Implementation lives in internalTrust.js (dependency-light
// + independently unit-tested for exploit resistance).
export { isTrustedInternalRequest } from "./internalTrust.js";

// Per-provider mutex — allows parallel credential selection across different providers
// while preventing races within the same provider's account rotation.
const _providerMutexes = new Map();

export function filterConnectionsForModel(providerId, connections, model, settings = {}) {
  const override = (settings.providerStrategies || {})[providerId] || {};
  if (providerId !== "freebuff" || override.strictModelAssignment !== true || !model) return connections;
  return connections.filter((connection) => {
    const data = connection.providerSpecificData || {};
    const assignedModel = Object.prototype.hasOwnProperty.call(data, "assignedModel")
      ? data.assignedModel
      : (providerId === "freebuff" ? data.freebuffModel : null);
    return assignedModel === model;
  });
}

function getProviderMutex(provider) {
  if (!_providerMutexes.has(provider)) {
    _providerMutexes.set(provider, Promise.resolve());
  }
  return _providerMutexes.get(provider);
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire per-provider mutex to prevent race conditions within same provider
  const currentMutex = getProviderMutex(provider);
  let resolveMutex;
  _providerMutexes.set(provider, new Promise(resolve => { resolveMutex = resolve; }));

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      let pickedId = override.proxyPoolId || null;
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true });
        const poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
        const scope = `${providerId}::${model || "*"}`;
        pickedId = pickProxyPoolId(poolIds, strategy, providerId, { scope });
      }
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
      const selectedPoolIds = strategy !== "none"
        ? (await getProxyPools({ isActive: true })).filter((p) => p.proxyUrl).map((p) => p.id)
        : [];
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
          proxyPoolId: resolvedProxy.proxyPoolId || null,
          strictProxy: resolvedProxy.strictProxy === true,
          proxyPoolIds: selectedPoolIds,
          proxyRotationStrategy: strategy,
          proxyPoolScope: `${providerId}::${model || "*"}`,
        },
      };
    }

    let connections = await getProviderConnections({ provider: providerId, isActive: true });
    const settings = await getSettings();
    connections = filterConnectionsForModel(providerId, connections, model, settings);
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Antigravity quota cache is lazy: only populated after that account returns 409/429.
    const isAntigravity = providerId === "antigravity";
    const antigravityQuotaCache = isAntigravity && model ? getAntigravityQuotaCache() : null;

    // Filter out model-locked, excluded, and Antigravity quota-exhausted connections
    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      // Antigravity: skip if live quota exhausted for this model
      if (isAntigravity && model && antigravityQuotaCache) {
        const quota = antigravityQuotaCache.get(c.id)?.[model];
        if (quota && quota.remainingPercentage <= 0 && quota.resetAt && new Date(quota.resetAt).getTime() > Date.now()) {
          const account = c.id?.slice(0, 8) || "unknown";
          log.info("AG_QUOTA", `${account} | CACHE_BLOCK ${model} — skip upstream until ${quota.resetAt}`);
          return false;
        }
      }
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      // Find earliest persistent lock or lazy Antigravity quota-cache reset for retry timing
      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.flatMap(c => { const t = getEarliestModelLockUntil(c); return t ? [t] : []; });
      if (isAntigravity && model && antigravityQuotaCache) {
        connections.forEach((c) => {
          const resetAt = antigravityQuotaCache.get(c.id)?.[model]?.resetAt;
          if (resetAt && new Date(resetAt).getTime() > Date.now()) expiries.push(resetAt);
        });
      }
      const earliest = expiries.length > 0 ? expiries.reduce((a, b) => a < b ? a : b) : null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          connectionId: earliestConn?.id || null,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    // Per-provider strategy overrides global setting
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      // Sort by lastUsed (most recent first) to find current candidate
      const byRecency = availableConnections.toSorted((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        // Stay with current account
        connection = current;
        // Update lastUsedAt and increment count (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      } else {
        // Pick the least recently used (excluding current if possible)
        const sortedByOldest = availableConnections.toSorted((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        // Update lastUsedAt and reset count to 1 (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        });
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    const psdForProxy = providerId === "freebuff"
      ? { ...(connection.providerSpecificData || {}), proxyPoolScope: `${providerId}::${model || ""}` }
      : connection.providerSpecificData?.proxyPoolIds?.length
        ? { ...connection.providerSpecificData, proxyPoolScope: `${providerId}::${model || ""}` }
        : connection.providerSpecificData;
    const resolvedProxy = providerId === "antigravity"
      ? resolveAntigravityProxyConfig(psdForProxy)
      : await resolveConnectionProxyConfig(psdForProxy || {}, connection.id);

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        proxyPoolId: resolvedProxy.proxyPoolId || null,
        noFitPool: resolvedProxy.noFitPool === true,
        strictProxy: resolvedProxy.strictProxy === true,
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null, options = {}) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  const isA6 = provider === "a6api" || provider === "a6api-cli";
  if (isA6 && status !== 401 && status !== 402 && status !== 404) {
    shouldFallback = true;
    cooldownMs = 3000; // 3 seconds cooldown for all non-401/402/404 errors
    newBackoffLevel = 0;
  } else if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    // Antigravity quota API provides exact per-model resetAt. Do not truncate it.
    cooldownMs = resolveProviderId(provider) === "antigravity"
      ? resetsAtMs - Date.now()
      : Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else if (status === 429) {
    // Use classify429 for all 429 responses so rate_limit, quota_exhausted,
    // and daily_quota get deterministic, semantically correct cooldowns
    // instead of generic exponential backoff. This also prevents the daily
    // quota lock set earlier in the request path from being overwritten with
    // a shorter backoff cooldown.
    const classification = classify429({ status, body: errorText, provider });
    shouldFallback = true;
    cooldownMs = classification.cooldownMs;
    newBackoffLevel = backoffLevel;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  // When the circuit-breaker / loop-guard toggle is OFF, do NOT write a per-account
  // model lock (mirrors chat behavior when the toggle is disabled). We still return
  // shouldFallback so the request falls through to the next account/provider, but we
  // leave the account lock state untouched.
  const disableLock = options && options.disableLock === true;

  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";

  if (disableLock) {
    // Toggle OFF: skip the lock write entirely so the account stays usable.
    return { shouldFallback: true, cooldownMs };
  }

  const lockUpdate = buildModelLockUpdate(model, cooldownMs);

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true;    // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key and return key info (including allowedProviders)
 * Returns null if invalid, or the key object if valid
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return null;
  return await validateApiKey(apiKey);
}

/**
 * Check if a provider is allowed for a given API key info object.
 * null = all allowed (default). [] = none allowed. [x] = only x.
 *
 * For openai-compatible / anthropic-compatible / custom-embedding providers
 * (whose ids embed a UUID suffix), the connection's node prefix is also
 * accepted as a match — the UUID-suffixed id is not user-meaningful and
 * /v1/models lists these under their prefix alias.
 */
const _nodePrefixCache = new Map(); // id -> { prefix, expires }
const NODE_PREFIX_CACHE_TTL_MS = 30000;
async function getNodePrefix(providerId) {
  const cached = _nodePrefixCache.get(providerId);
  if (cached && cached.expires > Date.now()) return cached.prefix;
  try {
    const node = await getProviderNodeById(providerId);
    const prefix = node?.prefix || null;
    _nodePrefixCache.set(providerId, { prefix, expires: Date.now() + NODE_PREFIX_CACHE_TTL_MS });
    return prefix;
  } catch {
    _nodePrefixCache.set(providerId, { prefix: null, expires: Date.now() + NODE_PREFIX_CACHE_TTL_MS });
    return null;
  }
}
export async function isProviderAllowed(apiKeyInfo, providerIdOrAlias) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedProviders;
  if (allowed === null || allowed === undefined) return true; // null = all
  if (!Array.isArray(allowed) || allowed.length === 0) return false; // [] = none
  if (allowed.includes(providerIdOrAlias)) return true;
  const alias = getProviderAlias(providerIdOrAlias);
  if (alias !== providerIdOrAlias && allowed.includes(alias)) return true;
  const resolvedId = resolveProviderId(providerIdOrAlias);
  if (resolvedId !== providerIdOrAlias && allowed.includes(resolvedId)) return true;
  if (isOpenAICompatibleProvider(providerIdOrAlias) || isAnthropicCompatibleProvider(providerIdOrAlias) || isCustomEmbeddingProvider(providerIdOrAlias)) {
    const prefix = await getNodePrefix(providerIdOrAlias);
    if (prefix && allowed.includes(prefix)) return true;
  }
  return false;
}

/**
 * Check if a combo name is allowed for a given API key.
 * null = all allowed (default). [] = none allowed. [x] = only x.
 */
export function isComboAllowed(apiKeyInfo, comboName) {
  if (!apiKeyInfo) return true;
  const name = comboName.startsWith("combo/") ? comboName.slice(6) : comboName;
  const allowed = apiKeyInfo.allowedCombos;
  if (allowed === null || allowed === undefined) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(name);
}

/**
 * Check if a request kind is allowed for a given API key.
 * Kinds: "llm", "embedding", "image", "tts", "stt", "web"
 * null = all allowed (default). [] = none allowed. [x] = only x.
 */
export function isKindAllowed(apiKeyInfo, kind) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedKinds;
  if (allowed === null || allowed === undefined) return true; // null = all
  if (!Array.isArray(allowed) || allowed.length === 0) return false; // [] = none
  return allowed.includes(kind);
}

/**
 * Check if a model name is allowed for a given API key.
 * null = all allowed (default). [] = none allowed. [x] = only x.
 * Supports exact match, model alias match, or wildcard glob match (e.g. "claude-*", "gpt-4*").
 */
export function isModelAllowed(apiKeyInfo, modelName) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedModels;
  if (allowed === null || allowed === undefined) return true; // null = all
  if (!Array.isArray(allowed) || allowed.length === 0) return false; // [] = none
  if (!modelName) return false;

  const target = String(modelName).trim().toLowerCase();
  for (const item of allowed) {
    if (!item) continue;
    const pat = String(item).trim().toLowerCase();
    if (pat === target) return true;
    if (pat.includes("*")) {
      const escaped = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      const regex = new RegExp(`^${escaped}$`);
      if (regex.test(target)) return true;
    }
  }
  return false;
}
