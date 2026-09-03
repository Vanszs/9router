import { BaseExecutor } from "./base.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import crypto from "node:crypto";
import { resolveSessionId } from "../utils/sessionManager.js";

// Models that use /zen/go/v1/messages (Anthropic/Claude format + x-api-key auth)
const MESSAGES_FORMAT_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);

const RESPONSES_MODELS = new Set([
  "grok-4.6",
  "gpt-5.6-luna",
  "muse-spark-1.2-contributor",
  "muse-spark-1.3-contributor",
]);

const BASE = "https://opencode.ai/zen/go/v1";

function generateSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

function generateRequestId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

// Conversation-stable session id for the OpenCode relay: client-provided
// header wins, then a per-connection/assistant-text derivation (same
// resolution the sibling opencode zen executor uses; scoped apart so cache
// keys don't collide across the two relay flavors).
function resolveOpencodeSession(body, credentials) {
  const headers = credentials?.rawHeaders || {};
  return resolveSessionId({
    headers,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode-go",
    generate: generateSessionId,
  });
}

function baseModelId(model) {
  return String(model || "")
    .replace(/\([^()]+\)\s*$/, "")
    .trim();
}

function isResponsesModel(model) {
  return RESPONSES_MODELS.has(baseModelId(model));
}

function normalizeOpencodeReasoning(model, body) {
  const current = body.reasoning;
  const currentReasoning =
    current && typeof current === "object" && !Array.isArray(current)
      ? current
      : null;
  const requestedEffort =
    typeof body.reasoning_effort === "string"
      ? body.reasoning_effort
      : currentReasoning?.effort;
  if (typeof requestedEffort !== "string") return;

  const cleanModel = baseModelId(model || body.model);
  const supportedLevels = getThinkingLevels("opencode", cleanModel);
  let effort = requestedEffort.toLowerCase().trim();
  if (
    (effort === "max" || effort === "ultra") &&
    supportedLevels?.length &&
    !supportedLevels.includes(effort)
  ) {
    if (effort === "ultra" && supportedLevels.includes("max")) effort = "max";
    else if (supportedLevels.includes("xhigh")) effort = "xhigh";
  }

  body.reasoning = { ...currentReasoning, effort };
  if (!body.reasoning.summary) body.reasoning.summary = "auto";
  delete body.reasoning_effort;
}

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache model here
  buildUrl(model) {
    this._lastModel = model;
    return MESSAGES_FORMAT_MODELS.has(model)
      ? `${BASE}/messages`
      : isResponsesModel(model)
        ? `${BASE}/responses`
        : `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const raw = Object.fromEntries(
      Object.entries(credentials?.rawHeaders || {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const headers = { "Content-Type": "application/json" };

    if (MESSAGES_FORMAT_MODELS.has(this._lastModel)) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

    // OpenCode relay affinity/cache headers — mirror the sibling opencode zen
    // executor. Client-provided values win; otherwise stable per-conversation
    // ids so the relay keeps one backend warm across turns.
    headers["x-opencode-client"] = raw["x-opencode-client"] || "desktop";
    headers["x-opencode-session"] =
      raw["x-opencode-session"] ||
      credentials?.runtimeOpencodeSession ||
      generateSessionId();
    headers["x-opencode-request"] =
      raw["x-opencode-request"] || generateRequestId();
    headers["x-opencode-project"] = raw["x-opencode-project"] || "global";

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    this._currentSessionId = resolveOpencodeSession(body, credentials);
    if (credentials) credentials.runtimeOpencodeSession = this._currentSessionId;
    if (isResponsesModel(model)) {
      // Responses API names the output cap max_output_tokens and takes thinking
      // as reasoning:{effort,summary} — normalize the Chat fields at this boundary.
      if (body.max_output_tokens === undefined) {
        if (body.max_completion_tokens !== undefined)
          body.max_output_tokens = body.max_completion_tokens;
        else if (body.max_tokens !== undefined)
          body.max_output_tokens = body.max_tokens;
      }
      delete body.max_tokens;
      delete body.max_completion_tokens;
      normalizeOpencodeReasoning(model, body);
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
