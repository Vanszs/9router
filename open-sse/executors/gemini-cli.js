import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GEMINI_CLI_API_CLIENT, geminiCLIUserAgent } from "../config/appConstants.js";
import { DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../config/defaultThinkingSignature.js";
import { getConsistentMachineId } from "../shared/machineId.js";

// Opt-in privileged-user-id header. Some Cloud Code Assist accounts (corporate SSO,
// verified org) require the Gemini CLI installation id to be echoed back in
// `x-gemini-api-privileged-user-id` to unlock full quota. Default off because for
// consumer accounts the header can trigger stricter abuse-scoring.
const PRIVILEGED_USER_ID_ENABLED =
  ["1", "true", "yes", "on"].includes(String(process.env.VANS_GEMINI_INCLUDE_PRIVILEGED_USER_ID || "").toLowerCase());

let _privilegedUserIdCache = null;
async function resolvePrivilegedUserId() {
  if (!PRIVILEGED_USER_ID_ENABLED) return null;
  if (_privilegedUserIdCache) return _privilegedUserIdCache;
  try {
    _privilegedUserIdCache = await getConsistentMachineId("gemini-cli-privileged-user-id");
  } catch {
    _privilegedUserIdCache = null;
  }
  return _privilegedUserIdCache;
}

// OpenAI / client fields that must never reach Cloud Code Assist (400 Unknown name).
const OPENAI_LEAK_FIELDS = [
  "reasoning_effort", "thinking", "reasoning", "output_config",
  "thinkingConfig", "enable_thinking", "thinking_budget",
  "messages", "max_tokens", "max_completion_tokens", "stream",
  "tool_choice", "response_format", "n", "stop", "user",
];

function stripOpenAILeakFields(obj) {
  if (!obj || typeof obj !== "object") return;
  for (const k of OPENAI_LEAK_FIELDS) delete obj[k];
}

// Translate include_reasoning (visible reasoning default) into Gemini's native
// includeThoughts flag. Lives in generationConfig.thinkingConfig so it traverses
// the Cloud Code Assist envelope correctly. When thinkingConfig already has
// includeThoughts (set by applyThinking from explicit reasoning), leave it.
// include_reasoning=false explicitly suppresses thoughts (visible reasoning OFF).
function applyIncludeReasoningToGemini(body) {
  if (!body || body.include_reasoning == null) return;
  const gc = getGeminiGenerationConfigForBody(body);
  if (!gc) return;
  let tc = gc.thinkingConfig;
  if (!tc || typeof tc !== "object") tc = {};
  // Dashboard visible-reasoning always wins for includeThoughts. applyThinking may
  // have already set a default; we must overwrite so intermittent "no thoughts"
  // leaks (when applyThinking set includeThoughts first) are fixed.
  if (body.include_reasoning === true) {
    tc.includeThoughts = true;
    // Ensure a thinking budget/level exists so Gemini actually thinks.
    if (tc.thinkingLevel == null && tc.thinkingBudget == null) {
      tc.thinkingBudget = -1;
    }
  } else if (body.include_reasoning === false) {
    tc.includeThoughts = false;
  }
  gc.thinkingConfig = tc;
}

function getGeminiGenerationConfigForBody(body) {
  if (body.request && typeof body.request === "object") {
    if (!body.request.generationConfig || typeof body.request.generationConfig !== "object") {
      body.request.generationConfig = {};
    }
    return body.request.generationConfig;
  }
  if (!body.generationConfig || typeof body.generationConfig !== "object") {
    body.generationConfig = {};
  }
  return body.generationConfig;
}

export class GeminiCLIExecutor extends BaseExecutor {
  constructor() {
    super("gemini-cli", PROVIDERS["gemini-cli"]);
  }

  buildUrl(model, stream, urlIndex = 0) {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${this.config.baseUrl}:${action}`;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": geminiCLIUserAgent(this._currentModel),
      "X-Goog-Api-Client": GEMINI_CLI_API_CLIENT,
      "Accept": stream ? "text/event-stream" : "application/json"
    };
    // Inject privileged user id when the cached one is available. The cache is
    // populated asynchronously in transformRequest; if the first request happens
    // before it's resolved the header is skipped (no waiting in a sync handler).
    if (PRIVILEGED_USER_ID_ENABLED && typeof _privilegedUserIdCache === "string" && _privilegedUserIdCache) {
      headers["x-gemini-api-privileged-user-id"] = _privilegedUserIdCache;
    }
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    // Store model for use in buildHeaders (called by base.execute after transformRequest)
    this._currentModel = model;
    // Kick off privileged-user-id resolution in the background (no await). By the
    // second request the cache is warm; the first request simply skips the header.
    if (PRIVILEGED_USER_ID_ENABLED && _privilegedUserIdCache === null) {
      resolvePrivilegedUserId().then(v => { _privilegedUserIdCache = v ?? ""; }).catch(() => {});
    }
    // Cloud Code Assist wraps the Gemini payload: { project, model, request: <body> }
    const isEnvelope = body && body.request && body.model;
    if (isEnvelope) {
      // Gemini 3 rejects replayed turns where a functionCall part has no thoughtSignature,
      // and rejects thought-only parts (thought=true with no text/functionCall). Clients
      // (Claude Code, IDE) don't persist thoughtSignature in their history, so we scrub
      // thought-only parts and backfill the canonical signature on bare functionCall parts.
      // Also normalize `parameters` → `parametersJsonSchema` (translator already does this for
      // OpenAI→CLI, but native/passthrough bodies may still carry the legacy field).
      const request = body.request;
      if (Array.isArray(request.contents)) {
        for (const turn of request.contents) {
          if (!Array.isArray(turn.parts)) continue;
          // Drop thought-only parts: assistant reasoning echo can't be replayed to Cloud Code
          // and triggers a 400 with "thought part without matching functionCall".
          turn.parts = turn.parts.filter(p => !(p?.thought === true && !p.text && !p.functionCall));
        }
        // Backfill thoughtSignature on functionCall parts missing it (Gemini 3 requirement).
        const needsBackfill = request.contents.some(turn =>
          Array.isArray(turn?.parts) && turn.parts.some(p => p?.functionCall && !p?.thoughtSignature)
        );
        if (needsBackfill) {
          for (const turn of request.contents) {
            if (!Array.isArray(turn?.parts)) continue;
            for (const p of turn.parts) {
              if (p?.functionCall && !p?.thoughtSignature) {
                p.thoughtSignature = DEFAULT_THINKING_GEMINI_CLI_SIGNATURE;
              }
            }
          }
        }
      }
      if (Array.isArray(request.tools)) {
        for (const toolGroup of request.tools) {
          if (!Array.isArray(toolGroup.functionDeclarations)) continue;
          for (const fn of toolGroup.functionDeclarations) {
            if (fn.parameters && !fn.parametersJsonSchema) {
              fn.parametersJsonSchema = fn.parameters;
              delete fn.parameters;
            }
          }
        }
      }
      // chatCore may re-inject OpenAI-only fields (reasoning_effort, thinking, …)
      // onto the translated envelope. Cloud Code rejects unknown top-level keys.
      stripOpenAILeakFields(body);
      if (body.request && typeof body.request === "object") {
        stripOpenAILeakFields(body.request);
        // user_prompt_id is not a v1internal request field — drop if present.
        delete body.request.user_prompt_id;
      }
      applyIncludeReasoningToGemini(body);
      delete body.include_reasoning;
      return body;
    }

    // Strip reasoning_effort and other non-standard fields that Google rejects
    stripOpenAILeakFields(body);
    applyIncludeReasoningToGemini(body);
    delete body.include_reasoning;
    return {
      project: credentials?.projectId || body?.project,
      model,
      request: body
    };
  }

  // Parse RetryInfo.retryDelay from Google API 429 body to surface upstream retry hint
  parseError(response, bodyText) {
    const base = super.parseError(response, bodyText);
    if (response.status !== 429 || !bodyText) return base;
    try {
      const parsed = JSON.parse(bodyText);
      const details = parsed?.error?.details;
      if (Array.isArray(details)) {
        for (const d of details) {
          if (d?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && d?.retryDelay) {
            base.retryAfter = d.retryDelay;
            break;
          }
        }
      }
    } catch {}
    return base;
  }

  async refreshCredentials(credentials, log) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      });

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Gemini CLI refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error) {
      log?.error?.("TOKEN", `Gemini CLI refresh error: ${error.message}`);
      return null;
    }
  }
}

