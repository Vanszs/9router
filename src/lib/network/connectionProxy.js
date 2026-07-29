import { getProxyPoolById } from "@/models";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {}
) {
  try {
    const proxyPoolIdRaw = normalizeString(
      providerSpecificData?.proxyPoolId
    );

    // "__none__" means explicitly disabled
    const proxyPoolId =
      proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);

      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      const isValidPool =
        proxyPool &&
        proxyPool.isActive === true &&
        proxyUrl;

      if (isValidPool) {
        /**
         * Vercel/Cloudflare relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno") {
          return {
            source: proxyPool.type,

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: proxyPool.strictProxy === true,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: proxyPool.strictProxy === true,
        };
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        ...legacy,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      ...legacy,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
    };
  }
}

/**
 * Stable djb2 hash for short string fingerprints (non-cryptographic).
 */
function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Compute a stable proxy bucket key for an account.
 * Groups accounts by the proxy they share so the semaphore and circuit
 * breaker can isolate failures per proxy.
 * @param {object} providerSpecificData
 * @returns {string} "direct" if no proxy, "proxy-<hash>" if explicit proxy, "pool-<hash>" if proxy pool
 */
export function getProxyHash(providerSpecificData = {}) {
  const enabled = providerSpecificData?.connectionProxyEnabled === true;
  const url = enabled ? normalizeString(providerSpecificData?.connectionProxyUrl) : "";
  if (url) return `proxy-${djb2(url)}`;
  const poolId = normalizeString(providerSpecificData?.proxyPoolId);
  if (poolId) return `pool-${djb2(poolId)}`;
  return "direct";
}

/**
 * ---------------------------------------------------------------------------
 * Proxy Rotation Strategy
 * ---------------------------------------------------------------------------
 *
 * Module-level state tracking for round-robin rotation.
 * Maps providerId -> { currentIndex, poolHash }
 * When the pool list changes (pools added/removed), the hash changes and the
 * cursor resets automatically.
 */

const _roundRobinState = new Map();

function computePoolHash(poolIds) {
  return [...poolIds].sort().join(",");
}

/**
 * Pick a proxy pool ID from the available pool list using the configured
 * rotation strategy.
 *
 * @param {string[]} poolIds    - Active proxy pool IDs to choose from.
 * @param {string}   strategy   - "random" or "round-robin".
 * @param {string}   providerId - Provider identifier (state key, each
 *                                provider rotates independently).
 * @returns {string|null} Selected proxy pool ID, or null if poolIds empty.
 */
export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!Array.isArray(poolIds) || poolIds.length === 0) return null;

  if (strategy === "random") {
    const idx = Math.floor(Math.random() * poolIds.length);
    return poolIds[idx];
  }

  if (strategy === "round-robin") {
    const currentHash = computePoolHash(poolIds);
    const prev = _roundRobinState.get(providerId);

    // Reset cursor when pool composition changes (pools added/removed)
    if (!prev || prev.poolHash !== currentHash) {
      _roundRobinState.set(providerId, { currentIndex: 0, poolHash: currentHash });
      return poolIds[0];
    }

    const nextIndex = (prev.currentIndex + 1) % poolIds.length;
    _roundRobinState.set(providerId, { currentIndex: nextIndex, poolHash: currentHash });
    return poolIds[nextIndex];
  }

  // Unknown strategy — fall back to first pool
  return poolIds[0];
}
