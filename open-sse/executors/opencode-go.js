import { BaseExecutor } from "./base.js";
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

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache model here
  buildUrl(model) {
    this._lastModel = model;
    return MESSAGES_FORMAT_MODELS.has(model)
      ? `${BASE}/messages`
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
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
