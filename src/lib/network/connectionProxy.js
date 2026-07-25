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

// In-memory counters for round-robin / fill-first proxy pool rotation.
// Keyed by `${providerId}:${strategy}` so different providers/strategies keep
// independent cursors; an integer cursor advances per pick. Process-local is
// sufficient — proxy pool rotation is best-effort, not a hard consistency requirement.
const _poolCursors = new Map();

/**
 * Pick a proxy pool id from a list of active pool ids using the configured strategy.
 *
 * Strategies:
 *  - "none" / falsy: returns null (no rotation)
 *  - "fill-first": always picks the first pool (sticky — drains pool[0] first)
 *  - "round-robin": advances cursor modulo pool length (fair distribution)
 *  - "random": uniform random pick
 *
 * @param {string[]} poolIds - active proxy pool ids with a proxyUrl
 * @param {string} strategy - rotation strategy from providerStrategies override
 * @param {string} providerId - provider id for per-provider cursor isolation
 * @returns {string|null} chosen pool id, or null when pool is empty / strategy none
 */
export function pickProxyPoolId(poolIds, strategy, providerId = "") {
  if (!Array.isArray(poolIds) || poolIds.length === 0) return null;
  const strat = String(strategy || "").toLowerCase();

  if (strat === "fill-first") return poolIds[0];

  if (strat === "round-robin") {
    const key = `${providerId}:${strat}`;
    const idx = (_poolCursors.get(key) ?? 0) % poolIds.length;
    _poolCursors.set(key, (idx + 1) % poolIds.length);
    return poolIds[idx];
  }

  if (strat === "random") {
    return poolIds[Math.floor(Math.random() * poolIds.length)];
  }

  return null;
}
