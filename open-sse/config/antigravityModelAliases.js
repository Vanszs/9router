const GEMINI_37_FLASH_BASE = Object.freeze({
  contextLength: 1048576,
  maxOutputTokens: 65536,
  supportsReasoning: true,
  supportsVision: true,
  toolCalling: true,
});

const GEMINI_36_FLASH_BASE = Object.freeze({
  contextLength: 1048576,
  maxOutputTokens: 65536,
  supportsReasoning: true,
  supportsVision: true,
  toolCalling: true,
});

export const ANTIGRAVITY_PUBLIC_MODELS = Object.freeze([
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5 (Thinking)",
    contextLength: 200000,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 (Thinking)",
    contextLength: 200000,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Thinking)",
    contextLength: 200000,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", ...GEMINI_37_FLASH_BASE },
  { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", ...GEMINI_37_FLASH_BASE },
  { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", ...GEMINI_37_FLASH_BASE },
  { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)", ...GEMINI_36_FLASH_BASE },
  { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)", ...GEMINI_36_FLASH_BASE },
  { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)", ...GEMINI_36_FLASH_BASE },
  {
    id: "gemini-3.5-flash-low",
    name: "Gemini 3.5 Flash (Low)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.5-flash-medium",
    name: "Gemini 3.5 Flash (Medium)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.5-flash-high",
    name: "Gemini 3.5 Flash (High)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3.1 Pro",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.1-pro-high",
    name: "Gemini 3.1 Pro (High)",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.1-pro-low",
    name: "Gemini 3.1 Pro (Low)",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    toolCalling: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    toolCalling: true,
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    toolCalling: true,
  },
  {
    id: "gemini-2.5-flash-thinking",
    name: "Gemini 2.5 Flash Thinking",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    toolCalling: true,
  },
  {
    id: "gemini-pro-agent",
    name: "Gemini 3.1 Pro (High)",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gpt-oss-120b-medium",
    name: "GPT-OSS 120B (Medium)",
    contextLength: 131072,
    maxOutputTokens: 32768,
    supportsReasoning: true,
    toolCalling: true,
  },
  { id: "gemini-3-pro-image-preview", name: "Gemini 3 Pro Image" },
  { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image" },
  {
    id: "gemini-2.5-computer-use-preview-10-2025",
    name: "Gemini 2.5 Computer Use Preview (10/2025)",
  },
]);

export const ANTIGRAVITY_MODEL_ALIASES = Object.freeze({
  "gemini-3.7-flash": "gemini-3.7-flash-medium",
  "gemini-3.7-flash-preview": "gemini-3.7-flash-high",
  "gemini-3.6-flash": "gemini-3.6-flash-medium",
  "gemini-3.6-flash-preview": "gemini-3.6-flash-high",
  "gemini-3.5-flash-low": "gemini-3.5-flash-extra-low",
  "gemini-3.5-flash-medium": "gemini-3.5-flash-low",
  "gemini-3.5-flash-high": "gemini-3-flash-agent",
  "gemini-3.5-flash-preview": "gemini-3-flash-agent",
  "gemini-3-pro-preview": "gemini-3.1-pro",
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
  "gemini-2.5-computer-use-preview-10-2025": "rev19-uic3-1p",
  "gemini-claude-sonnet-4-5": "claude-sonnet-4-6",
  "gemini-claude-sonnet-4-5-thinking": "claude-sonnet-4-6",
  "gemini-claude-opus-4-5-thinking": "claude-opus-4-6-thinking",
});

export const ANTIGRAVITY_PRO_FALLBACK_CHAINS = Object.freeze({
  "gemini-3.1-pro-high": Object.freeze([
    "gemini-3.1-pro-high",
    "gemini-pro-agent",
    "gemini-3-pro-high",
  ]),
  "gemini-3.1-pro-low": Object.freeze(["gemini-3.1-pro-low", "gemini-3-pro-low"]),
});

export function getAntigravityModelFallbacks(modelId) {
  if (!modelId) return [];
  return ANTIGRAVITY_PRO_FALLBACK_CHAINS[modelId] ?? [];
}

export const ANTIGRAVITY_REVERSE_MODEL_ALIASES = Object.freeze({
  "gemini-3.5-flash-extra-low": "gemini-3.5-flash-low",
  "gemini-3-flash-agent": "gemini-3.5-flash-high",
  "gemini-3.1-pro": "gemini-3-pro-preview",
  "gemini-3-pro-image": "gemini-3-pro-image-preview",
  "rev19-uic3-1p": "gemini-2.5-computer-use-preview-10-2025",
});

const CLIENT_VISIBLE_MODEL_NAMES = Object.freeze(
  ANTIGRAVITY_PUBLIC_MODELS.reduce((acc, model) => {
    acc[model.id] = model.name;
    return acc;
  }, {})
);

const PUBLIC_MODEL_IDS = new Set(ANTIGRAVITY_PUBLIC_MODELS.map((model) => model.id));
const UPSTREAM_PUBLIC_MODEL_IDS = new Set(
  ANTIGRAVITY_PUBLIC_MODELS.map((model) => resolveAntigravityModelId(model.id))
);

export function resolveAntigravityModelId(modelId) {
  if (!modelId) return modelId;
  return ANTIGRAVITY_MODEL_ALIASES[modelId] || modelId;
}

export function toClientAntigravityModelId(modelId) {
  if (!modelId) return modelId;
  return ANTIGRAVITY_REVERSE_MODEL_ALIASES[modelId] || modelId;
}

const ANTIGRAVITY_QUOTA_BUCKET_TO_CLIENT = Object.freeze({
  "gemini-3.5-flash-extra-low": "gemini-3.5-flash-low",
  "gemini-3.5-flash-low": "gemini-3.5-flash-medium",
  "gemini-3-flash-agent": "gemini-3.5-flash-high",
});

const ANTIGRAVITY_DROPPED_QUOTA_BUCKETS = new Set([
  "gemini-3.5-flash-preview",
  "gemini-3-flash-preview",
]);

export function toClientAntigravityQuotaModelId(modelId) {
  if (!modelId) return null;
  if (ANTIGRAVITY_DROPPED_QUOTA_BUCKETS.has(modelId)) return null;
  const tierClientId = ANTIGRAVITY_QUOTA_BUCKET_TO_CLIENT[modelId];
  if (tierClientId) return tierClientId;
  return toClientAntigravityModelId(modelId);
}

export function getClientVisibleAntigravityModelName(modelId, fallbackName) {
  return CLIENT_VISIBLE_MODEL_NAMES[modelId] || fallbackName || modelId;
}

export function isUserCallableAntigravityModelId(modelId) {
  if (!modelId) return false;
  const clientId = toClientAntigravityModelId(modelId);
  const upstreamId = resolveAntigravityModelId(modelId);
  return PUBLIC_MODEL_IDS.has(clientId) || UPSTREAM_PUBLIC_MODEL_IDS.has(upstreamId);
}
