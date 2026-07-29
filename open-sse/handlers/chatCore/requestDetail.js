import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { recordApiKeyUsage } from "@/lib/db/repos/apiKeyUsageRepo.js";
import { COLORS } from "../../utils/stream.js";
import { canonicalizeUsage } from "../../utils/usageTracking.js";

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls"
];

export function extractRequestConfig(body, stream) {
  const config = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  return config;
}

export function extractUsageFromResponse(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return null;

  // Claude format
  if (responseBody.usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      cache_read_input_tokens: responseBody.usage.cache_read_input_tokens,
      cache_creation_input_tokens: responseBody.usage.cache_creation_input_tokens
    };
  }

  // OpenAI format
  if (responseBody.usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.prompt_tokens || 0,
      completion_tokens: responseBody.usage.completion_tokens || 0,
      cached_tokens: responseBody.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: responseBody.usage.completion_tokens_details?.reasoning_tokens
    };
  }

  // Gemini / Antigravity format
  // Antigravity wraps usageMetadata inside response:
  //   { response: { candidates: [...], usageMetadata: {...} } }
  // Without the unwrap, non-stream Antigravity requests land as 0/0 in
  // requestDetails (and disappear from Recent Requests which filters
  // zero-token rows). Streaming path already unwraps this in
  // usageTracking.js; non-stream route uses a different function.
  const usageMeta = responseBody.usageMetadata || responseBody.response?.usageMetadata;
  if (usageMeta && typeof usageMeta === "object") {
    const thoughts = usageMeta.thoughtsTokenCount || 0;
    const candidates = usageMeta.candidatesTokenCount || 0;
    // Derive candidates from total when upstream omits it
    let completion = candidates;
    const total = usageMeta.totalTokenCount || 0;
    const prompt = usageMeta.promptTokenCount || 0;
    if (completion === 0 && total > 0) {
      completion = Math.max(0, total - prompt - thoughts);
    }
    return {
      prompt_tokens: prompt,
      // Fold thoughts into completion so saveUsageStats (which only reads
      // prompt/completion) doesn't drop reasoning-heavy AG responses as 0 out.
      completion_tokens: completion + thoughts,
      cached_tokens: usageMeta.cachedContentTokenCount || 0,
      reasoning_tokens: thoughts
    };
  }

  return null;
}

export function buildRequestDetail(base, overrides = {}) {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    apiKey: base.apiKey || null,
    apiKeyName: base.apiKeyName || null,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    pxpipe: base.pxpipe || undefined,
    status: base.status || "success",
    ...overrides
  };
}

export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, apiKeyInfo, endpoint, label = "USAGE" }) {
  if (!tokens || typeof tokens !== "object") return;

  const inTokens = tokens.input_tokens ?? tokens.prompt_tokens ?? 0;
  const outTokens = tokens.output_tokens ?? tokens.completion_tokens ?? 0;

  if (inTokens === 0 && outTokens === 0) return;

  const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
  console.log(`${COLORS.green}[${time}] 📊 [${label}] ${provider.toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${COLORS.reset}`);

  // Canonicalize to one storage convention (prompt_tokens cache-inclusive) so
  // cached/cache-creation tokens survive to cost calc + stats. See canonicalizeUsage.
  const normalized = canonicalizeUsage(tokens) || {
    prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
    completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0
  };

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null
  }).catch(() => {});

  // Record per-key usage limits against the API key info (if provided).
  if (apiKeyInfo) {
    const totalTokens = (normalized.prompt_tokens || 0) + (normalized.completion_tokens || 0);
    recordApiKeyUsage(apiKeyInfo, totalTokens);
  }
}
