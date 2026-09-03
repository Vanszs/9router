import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS, getModelKind } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  FREE_PROVIDERS,
  getProviderAlias,
  getProviderByAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import {
  getProviderConnections,
  getCombos,
  getCustomModels,
  getModelAliases,
  getCachedProviderModels,
  saveCachedProviderModels,
} from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveClinepassModels } from "open-sse/services/clinepassModels.js";
import { resolveGrokCliModels } from "open-sse/services/grokCliModels.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { capabilitiesFromServiceKind, getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { guardedFetch } from "@/shared/utils/ssrfGuard.js";

const UPSTREAM_CONNECTION_RE = /[-_][0-9a-f]{8,}$/i;
const LLM_KIND = "llm";
const ALL_KINDS = [LLM_KIND, "tts", "embedding", "image", "imageToText", "stt", "webSearch", "webFetch"];

const MODEL_TYPE_TO_KIND = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
};

const LIVE_MODEL_RESOLVERS = {
  kiro: async (conn) => {
    const result = await resolveKiroModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  qoder: async (conn) => {
    const result = await resolveQoderModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      email: conn.email,
      displayName: conn.displayName,
      providerSpecificData: conn.providerSpecificData || {}
    });
    if (!result?.models?.length) return null;
    return {
      models: result.models.map((m) => ({ id: m.id, name: m.name })),
    };
  },
  github: async (conn) => {
    const result = await resolveCopilotModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, {
      log: console,
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  "grok-cli": async (conn) => {
    const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
    const result = await resolveGrokCliModels({
      ...conn,
      connectionId: conn.id,
    }, {
      log: console,
      proxyOptions: {
        connectionProxyEnabled: proxy.connectionProxyEnabled === true,
        connectionProxyUrl: proxy.connectionProxyUrl || "",
        connectionNoProxy: proxy.connectionNoProxy || "",
        vercelRelayUrl: proxy.vercelRelayUrl || "",
        strictProxy: proxy.strictProxy === true,
      },
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  cursor: async (conn) => {
    const result = await resolveCursorModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  }
};

function modelKind(model) {
  const k = model?.kind || model?.type;
  if (!k) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[k] || LLM_KIND;
}

function appendConfiguredMediaModels(entries, providerInfo, alias, kindFilter, isDisabled = () => false) {
  if (!providerInfo || !alias) return;

  if (kindFilter.has("tts")) {
    if (Array.isArray(providerInfo.ttsConfig?.models)) {
      for (const m of providerInfo.ttsConfig.models) {
        if (m?.id && !isDisabled(alias, m.id)) {
          entries.push({ id: `${alias}/${m.id}`, object: "model", kind: "tts", owned_by: alias });
        }
      }
    } else if (providerInfo.ttsConfig) {
      entries.push({ id: `${alias}/tts`, object: "model", kind: "tts", owned_by: alias });
    }
  }

  if (kindFilter.has("stt")) {
    if (Array.isArray(providerInfo.sttConfig?.models)) {
      for (const m of providerInfo.sttConfig.models) {
        if (m?.id && !isDisabled(alias, m.id)) {
          entries.push({ id: `${alias}/${m.id}`, object: "model", kind: "stt", owned_by: alias });
        }
      }
    } else if (providerInfo.sttConfig) {
      entries.push({ id: `${alias}/stt`, object: "model", kind: "stt", owned_by: alias });
    }
  }

  if (kindFilter.has("image") && Array.isArray(providerInfo.imageConfig?.models)) {
    for (const m of providerInfo.imageConfig.models) {
      if (m?.id && !isDisabled(alias, m.id)) {
        entries.push({ id: `${alias}/${m.id}`, object: "model", kind: "image", owned_by: alias });
      }
    }
  }

  if (kindFilter.has("embedding") && Array.isArray(providerInfo.embeddingConfig?.models)) {
    for (const m of providerInfo.embeddingConfig.models) {
      if (m?.id && !isDisabled(alias, m.id)) {
        entries.push({ id: `${alias}/${m.id}`, object: "model", kind: "embedding", owned_by: alias });
      }
    }
  }

  if (kindFilter.has("webSearch") && (providerInfo.searchConfig || providerInfo.searchViaChat || providerInfo.serviceKinds?.includes("webSearch"))) {
    entries.push({ id: `${alias}/search`, object: "model", kind: "webSearch", owned_by: alias });
  }

  if (kindFilter.has("webFetch") && (providerInfo.fetchConfig || providerInfo.serviceKinds?.includes("webFetch"))) {
    entries.push({ id: `${alias}/fetch`, object: "model", kind: "webFetch", owned_by: alias });
  }
}

export function isConfiguredMediaModel(alias, modelId) {
  const provider = getProviderByAlias(alias);
  if (!provider) return false;
  if (modelId === "search" && (provider.searchConfig || provider.searchViaChat || provider.serviceKinds?.includes("webSearch"))) return true;
  if (modelId === "fetch" && (provider.fetchConfig || provider.serviceKinds?.includes("webFetch"))) return true;
  if (modelId === "stt" && (provider.sttConfig || provider.serviceKinds?.includes("stt"))) return true;
  if (modelId === "tts" && (provider.ttsConfig || provider.serviceKinds?.includes("tts"))) return true;
  if (modelId === "image" && (provider.imageConfig || provider.serviceKinds?.includes("image"))) return true;
  if (provider.ttsConfig?.models?.some((m) => m.id === modelId)) return true;
  if (provider.sttConfig?.models?.some((m) => m.id === modelId)) return true;
  if (provider.imageConfig?.models?.some((m) => m.id === modelId)) return true;
  if (provider.embeddingConfig?.models?.some((m) => m.id === modelId)) return true;
  return false;
}

function inferKindFromUnknownModelId(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

function providerMatchesKinds(providerId, kindFilter) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kinds.some((k) => kindFilter.has(k));
}

function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.has(kind);
}

let _modelsFetcherCache = {};
let _modelsFetcherCacheExpiry = {};
const MODELS_FETCHER_CACHE_TTL_MS = 300000;
const _liveModelsCache = new Map();
const LIVE_MODELS_CACHE_TTL_MS = 300000;

export async function fetchModelsFetcherIds(providerId, providerInfo) {
  const fetcher = providerInfo?.modelsFetcher;
  if (!fetcher?.url) return [];

  const now = Date.now();
  if (_modelsFetcherCache[providerId] && now < (_modelsFetcherCacheExpiry[providerId] || 0)) {
    return _modelsFetcherCache[providerId];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(fetcher.url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return _modelsFetcherCacheExpiry[providerId] > now ? _modelsFetcherCache[providerId] : [];
    }

    const data = await response.json();
    let rawModels;
    if (Array.isArray(data)) {
      rawModels = data;
    } else if (Array.isArray(data?.data)) {
      rawModels = data.data;
    } else if (data?.models && typeof data.models === "object" && !Array.isArray(data.models)) {
      rawModels = Object.values(data.models);
    } else if (Array.isArray(data?.results)) {
      rawModels = data.results;
    } else if (data && typeof data === "object") {
      const providerKey = providerInfo?.id || providerId;
      const aliasKey = providerInfo?.alias || providerInfo?.uiAlias;
      const entry = data[providerKey] || data[aliasKey] || data[providerId];
      const models = entry?.models;
      rawModels = models && typeof models === "object" && !Array.isArray(models)
        ? Object.values(models)
        : [];
    } else {
      rawModels = data?.models || data?.results || [];
    }

    let ids;
    if (fetcher.type === "opencode-free") {
      ids = rawModels.reduce((acc, m) => {
        const id = m?.id || m?.name || m?.model;
        if (typeof id === "string" && id.trim() !== "" && id.endsWith("-free")) acc.push(id);
        return acc;
      }, []);
    } else {
      ids = rawModels.reduce((acc, m) => {
        const id = m?.id || m?.name || m?.model;
        if (typeof id === "string" && id.trim() !== "") acc.push(id);
        return acc;
      }, []);
    }

    const result = Array.from(new Set(ids));
    _modelsFetcherCache[providerId] = result;
    _modelsFetcherCacheExpiry[providerId] = now + MODELS_FETCHER_CACHE_TTL_MS;
    return result;
  } catch {
    return _modelsFetcherCache[providerId] || [];
  }
}

if (!globalThis._compatibleModelsCache) globalThis._compatibleModelsCache = new Map();
const _compatibleModelsCache = globalThis._compatibleModelsCache;
const COMPATIBLE_MODELS_CACHE_TTL_MS = 300000;

async function fetchCompatibleModelIds(connection) {
  if (!connection?.apiKey) return [];

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
    : "";

  if (!baseUrl) return [];

  const cacheKey = `${connection.provider}:${baseUrl}:${connection.apiKey}`;
  const now = Date.now();
  const cached = _compatibleModelsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.ids;
  }

  let url = `${baseUrl}/models`;
  const headers = { "Content-Type": "application/json" };

  if (isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await guardedFetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return [];
    const data = await response.json();
    const rawModels = Array.isArray(data) ? data : (data?.data || data?.models || data?.results || []);
    const result = Array.from(
      new Set(
        rawModels.reduce((acc, model) => {
          const modelId = model?.id || model?.name || model?.model;
          if (typeof modelId === "string" && modelId.trim() !== "") acc.push(modelId);
          return acc;
        }, [])
      )
    );
    _compatibleModelsCache.set(cacheKey, { ids: result, expiresAt: now + COMPATIBLE_MODELS_CACHE_TTL_MS });
    return result;
  } catch {
    return _compatibleModelsCache.get(cacheKey)?.ids || [];
  }
}

async function loadDbData() {
  const [connRes, comboRes, customRes, aliasRes, disabledRes] = await Promise.allSettled([
    getProviderConnections(),
    getCombos(),
    getCustomModels(),
    getModelAliases(),
    getDisabledModels(),
  ]);

  const connections = connRes.status === "fulfilled" && Array.isArray(connRes.value)
    ? connRes.value.filter(c => c?.isActive !== false)
    : [];
  const combos = comboRes.status === "fulfilled" && Array.isArray(comboRes.value) ? comboRes.value : [];
  const customModels = customRes.status === "fulfilled" && Array.isArray(customRes.value) ? customRes.value : [];
  const modelAliases = aliasRes.status === "fulfilled" && aliasRes.value ? aliasRes.value : {};
  const disabledByAlias = disabledRes.status === "fulfilled" && disabledRes.value ? disabledRes.value : {};

  const dbAvailable = connRes.status === "fulfilled" || comboRes.status === "fulfilled";
  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && disabledByAlias[alias].includes(modelId);

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  return { connections, combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable };
}

async function buildAllModelEntries(kindFilter, combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable, options = {}) {
  const skipDynamicFetch = options.skipDynamicFetch === true;
  kindFilter = new Set(kindFilter);
  const entries = [];

  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry = { id: `combo/${combo.name}`, object: "model", owned_by: "combo" };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    }
    entries.push(entry);
  }

  if (!dbAvailable) {
    const aliasToProviderId = Object.fromEntries(
      Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
    );
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] || alias;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      for (const model of providerModels) {
        if (!kindFilter.has(modelKind(model))) continue;
        if (isDisabled(alias, model.id)) continue;
        entries.push({ id: `${alias}/${model.id}`, object: "model", owned_by: alias });
      }
    }
    for (const [providerId, providerInfo] of Object.entries(AI_PROVIDERS)) {
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      const alias = getProviderAlias(providerId) || providerInfo.alias || providerId;
      appendConfiguredMediaModels(entries, providerInfo, alias, kindFilter, isDisabled);
    }
    for (const customModel of customModels) {
      if (!customModel?.id || (customModel.type && customModel.type !== "llm")) continue;
      if (!kindFilter.has(LLM_KIND)) continue;
      const providerAlias = customModel.providerAlias;
      if (!providerAlias) continue;
      const modelId = String(customModel.id).trim();
      if (!modelId) continue;
      entries.push({ id: `${providerAlias}/${modelId}`, object: "model", owned_by: providerAlias });
    }
  } else {
    const activeProviders = [...activeConnectionByProvider.entries()].filter(([providerId]) =>
      providerMatchesKinds(providerId, kindFilter)
    );
    const connResults = await Promise.allSettled(
      activeProviders.map(([providerId, conn]) =>
        buildConnectedProviderIds(providerId, conn, kindFilter, customModels, modelAliases, isDisabled, skipDynamicFetch)
      )
    );
    for (const res of connResults) {
      if (res.status === "fulfilled" && Array.isArray(res.value)) {
        entries.push(...res.value);
      }
    }
  }

  const noAuthProviders = Object.entries(AI_PROVIDERS).filter(([providerId, providerInfo]) =>
    !activeConnectionByProvider.has(providerId) && providerMatchesKinds(providerId, kindFilter) && (
      providerInfo.noAuth ||
      (kindFilter.has("webSearch") && (providerInfo.searchConfig || providerInfo.searchViaChat)) ||
      (kindFilter.has("webFetch") && providerInfo.fetchConfig)
    )
  );
  const noAuthResults = await Promise.allSettled(
    noAuthProviders.map(([providerId, providerInfo]) =>
      buildFreeProviderIds(providerId, providerInfo, kindFilter, customModels, modelAliases, isDisabled)
    )
  );
  for (const res of noAuthResults) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      entries.push(...res.value);
    }
  }

  return entries;
}

async function buildConnectedProviderIds(providerId, conn, kindFilter, customModels, modelAliases, isDisabled, skipDynamicFetch = false) {
  const entries = [];
  const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const outputAlias = (
    conn?.providerSpecificData?.prefix
    || getProviderAlias(providerId)
    || staticAlias
  ).trim();
  const providerModels = PROVIDER_MODELS[staticAlias] || [];
  const enabledModels = conn?.providerSpecificData?.enabledModels;
  const hasExplicitEnabledModels = Array.isArray(enabledModels) && enabledModels.length > 0;
  const isCompatibleProvider =
    isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
  const isPassthroughProvider = AI_PROVIDERS[providerId]?.passthroughModels === true;

  const staticModelKindById = new Map(providerModels.map((m) => [m.id, modelKind(m)]));

  let rawModelIds = hasExplicitEnabledModels
    ? Array.from(new Set(enabledModels.filter((id) => typeof id === "string" && id.trim() !== "")))
    : providerModels.map((m) => m.id);

  if (isCompatibleProvider && rawModelIds.length === 0 && !UPSTREAM_CONNECTION_RE.test(providerId) && !skipDynamicFetch) {
    rawModelIds = await fetchCompatibleModelIds(conn);
  }

  const providerInfo = AI_PROVIDERS[providerId];
  if (providerInfo?.noAuth && providerInfo?.modelsFetcher) {
    const fetcherIds = await fetchModelsFetcherIds(providerId, providerInfo);
    rawModelIds = Array.from(new Set([...rawModelIds, ...fetcherIds]));
  }

  if (isPassthroughProvider && rawModelIds.length === 0) {
    rawModelIds = providerModels.map((m) => m.id);
  }

  if (isPassthroughProvider && !hasExplicitEnabledModels) {
    rawModelIds = providerModels.map((m) => m.id);
  }

  const liveResolver = LIVE_MODEL_RESOLVERS[providerId];
  let liveCapabilitiesById = new Map();
  let liveKind = null;
  if (liveResolver && !hasExplicitEnabledModels && !skipDynamicFetch) {
    try {
      const live = await liveResolver(conn);
      if (live?.models?.length) {
        const liveIds = live.models
          .map((m) => m.id)
          .filter((id) => typeof id === "string" && id.trim() !== "");
        rawModelIds = Array.from(new Set([...rawModelIds, ...liveIds]));
        for (const m of live.models) {
          if (m.id && m.capabilities) liveCapabilitiesById.set(m.id, m.capabilities);
        }
        liveKind = live.kind || null;
        _liveModelsCache.set(`${providerId}:${conn.id}`, {
          models: live.models,
          kind: liveKind,
          expiresAt: Date.now() + LIVE_MODELS_CACHE_TTL_MS,
        });
      }
    } catch (err) {
      console.log(`Live model fetch failed for ${providerId}: ${err?.message || err}`);
      const cachedLive = _liveModelsCache.get(`${providerId}:${conn.id}`);
      if (cachedLive?.expiresAt > Date.now()) {
        rawModelIds = Array.from(new Set([
          ...rawModelIds,
          ...cachedLive.models.map((m) => m.id).filter((id) => typeof id === "string" && id.trim() !== ""),
        ]));
        for (const m of cachedLive.models) {
          if (m.id && m.capabilities) liveCapabilitiesById.set(m.id, m.capabilities);
        }
        liveKind = cachedLive.kind;
      }
    }
  }

  const modelIds = rawModelIds.reduce((acc, modelId) => {
    let id = modelId;
    if (id.startsWith(`${outputAlias}/`)) id = id.slice(outputAlias.length + 1);
    else if (id.startsWith(`${staticAlias}/`)) id = id.slice(staticAlias.length + 1);
    else if (id.startsWith(`${providerId}/`)) id = id.slice(providerId.length + 1);
    if (typeof id === "string" && id.trim() !== "") acc.push(id);
    return acc;
  }, []);

  const customModelKindById = new Map();
  const customModelIds = customModels.reduce((acc, m) => {
    if (!m?.id) return acc;
    const kind = getModelKind(m) || LLM_KIND;
    if (!kindFilter.has(kind) && !(kind === "imageToText" && kindFilter.has(LLM_KIND))) return acc;
    const alias = m.providerAlias;
    if (alias !== staticAlias && alias !== outputAlias && alias !== providerId) return acc;
    const id = String(m.id).trim();
    if (id !== "") {
      customModelKindById.set(id, kind);
      acc.push(id);
    }
    return acc;
  }, []);

  const aliasModelIds = Object.values(modelAliases || {}).reduce((acc, fullModel) => {
    if (typeof fullModel !== "string" || !fullModel.includes("/")) return acc;
    if (!fullModel.startsWith(`${outputAlias}/`) && !fullModel.startsWith(`${staticAlias}/`) && !fullModel.startsWith(`${providerId}/`)) return acc;
    let id;
    if (fullModel.startsWith(`${outputAlias}/`)) id = fullModel.slice(outputAlias.length + 1);
    else if (fullModel.startsWith(`${staticAlias}/`)) id = fullModel.slice(staticAlias.length + 1);
    else id = fullModel.slice(providerId.length + 1);
    if (typeof id === "string" && id.trim() !== "") acc.push(id);
    return acc;
  }, []);

  const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds, ...aliasModelIds]));
  for (const modelId of mergedModelIds) {
    const customKind = customModelKindById.get(modelId);
    const kind = staticModelKindById.get(modelId) || customKind || inferKindFromUnknownModelId(modelId);
    const allowAsLlm = kind === "imageToText" && kindFilter.has(LLM_KIND);
    if (!kindFilter.has(kind) && !allowAsLlm) continue;
    if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;

    const entry = {
      id: `${outputAlias}/${modelId}`,
      object: "model",
      owned_by: outputAlias,
    };

    const caps = liveCapabilitiesById.get(modelId)
      || capabilitiesFromServiceKind(customKind || liveKind)
      || (kind === LLM_KIND ? getCapabilitiesForModel(providerId, modelId) : null);
    if (caps) entry.capabilities = caps;

    entries.push(entry);
  }

  appendConfiguredMediaModels(entries, providerInfo, outputAlias, kindFilter, (alias, id) => isDisabled(outputAlias, id) || isDisabled(staticAlias, id));

  return entries;
}

async function buildFreeProviderIds(providerId, providerInfo, kindFilter, customModels, modelAliases, isDisabled) {
  const entries = [];
  const outputAlias = getProviderAlias(providerId) || providerInfo.alias || providerId;
  const staticModelKindById = new Map(
    (PROVIDER_MODELS[outputAlias] || []).map((m) => [m.id, modelKind(m)])
  );

  const modelIds = (PROVIDER_MODELS[outputAlias] || []).map((m) => m.id);

  let fetcherModelIds = [];
  if (providerInfo.modelsFetcher) {
    fetcherModelIds = await fetchModelsFetcherIds(providerId, providerInfo);
  }

  const customModelIds = customModels.reduce((acc, m) => {
    if (!m?.id || (m.type && m.type !== "llm")) return acc;
    const alias = m.providerAlias;
    if (alias !== outputAlias && alias !== providerId) return acc;
    const id = String(m.id).trim();
    if (id !== "") acc.push(id);
    return acc;
  }, []);
  const aliasModelIds = Object.values(modelAliases || {}).reduce((acc, fullModel) => {
    if (typeof fullModel !== "string" || !fullModel.includes("/")) return acc;
    if (!fullModel.startsWith(`${outputAlias}/`) && !fullModel.startsWith(`${providerId}/`)) return acc;
    let id;
    if (fullModel.startsWith(`${outputAlias}/`)) id = fullModel.slice(outputAlias.length + 1);
    else id = fullModel.slice(providerId.length + 1);
    if (typeof id === "string" && id.trim() !== "") acc.push(id);
    return acc;
  }, []);

  const mergedModelIds = Array.from(new Set([...modelIds, ...fetcherModelIds, ...customModelIds, ...aliasModelIds]));
  for (const modelId of mergedModelIds) {
    const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
    if (!kindFilter.has(kind)) continue;
    if (isDisabled(outputAlias, modelId)) continue;
    entries.push({ id: `${outputAlias}/${modelId}`, object: "model", owned_by: outputAlias });
  }

  appendConfiguredMediaModels(entries, providerInfo, outputAlias, kindFilter, isDisabled);

  return entries;
}

if (!globalThis._modelsListCache) globalThis._modelsListCache = new Map();
const _modelsListCache = globalThis._modelsListCache;
const MODELS_LIST_CACHE_TTL_MS = 15000;

export async function buildModelsList(kindFilter, options = {}) {
  const kindsKey = Array.isArray(kindFilter) ? kindFilter.slice().sort().join(",") : String(kindFilter);
  const cacheKey = `${kindsKey}:${options.skipDynamicFetch === true ? "skip" : "noskip"}`;
  const now = Date.now();
  const cached = _modelsListCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.models;
  }

  const { combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable } = await loadDbData();
  let entries = await buildAllModelEntries(kindFilter, combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable, options);

  const seen = new Set();
  const dedupedModels = [];
  for (const entry of entries) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const model = {
      id: entry.id,
      object: "model",
      owned_by: entry.owned_by || (entry.id.includes("/") ? entry.id.split("/")[0] : "combo"),
    };
    if (entry.kind) model.kind = entry.kind;
    if (entry.capabilities) model.capabilities = entry.capabilities;
    const caps = entry.capabilities || {};
    if (entry.kind === "llm" || !entry.kind) {
      if (Number.isFinite(caps.contextWindow)) model.context_length = caps.contextWindow;
      if (Number.isFinite(caps.maxOutput)) model.max_completion_tokens = caps.maxOutput;
    }
    dedupedModels.push(model);
  }

  // If live resolution yielded zero models, fallback to SQLite materialized catalog
  if (dedupedModels.length === 0) {
    const cachedDbModels = await getCachedProviderModels();
    if (cachedDbModels.length > 0) {
      for (const model of cachedDbModels) {
        if (!seen.has(model.id)) {
          seen.add(model.id);
          dedupedModels.push(model);
        }
      }
    }
  }

  _modelsListCache.set(cacheKey, { models: dedupedModels, expiresAt: now + MODELS_LIST_CACHE_TTL_MS });

  // Background materialization into SQLite cachedProviderModels table
  if (dedupedModels.length > 0) {
    saveCachedProviderModels(dedupedModels).catch(() => {});
  }

  return dedupedModels;
}



let _allowedCache = null;
let _allowedCacheExpiry = 0;
const ALLOWED_CACHE_TTL_MS = 30000;

async function getAllowedModelIds() {
  const now = Date.now();
  if (_allowedCache && now < _allowedCacheExpiry) return _allowedCache;

  const { combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable } = await loadDbData();
  const entries = await buildAllModelEntries(ALL_KINDS, combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable);

  const allIds = new Set();
  for (const entry of entries) {
    if (entry?.id) allIds.add(entry.id);
  }

  _allowedCache = allIds;
  _allowedCacheExpiry = now + ALLOWED_CACHE_TTL_MS;
  return allIds;
}

export function invalidateAllowedModelsCache() {
  _allowedCache = null;
  _allowedCacheExpiry = 0;
  _modelsListCache.clear();
  _compatibleModelsCache.clear();
}

export async function isModelAllowed(modelStr, apiKeyInfo = null) {
  if (!apiKeyInfo) return true;
  const allowed = await getAllowedModelIds();
  if (allowed.has(modelStr)) return true;

  // Virtual and config-defined endpoints for media kinds (webSearch, webFetch, stt, tts, image, embedding)
  if (typeof modelStr === "string" && modelStr.includes("/")) {
    const slash = modelStr.indexOf("/");
    const alias = modelStr.slice(0, slash);
    const modelId = modelStr.slice(slash + 1);
    return isConfiguredMediaModel(alias, modelId);
  }

  return false;
}

