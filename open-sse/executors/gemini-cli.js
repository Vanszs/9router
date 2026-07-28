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
let _privilegedUserIdPromise = null;
async function resolvePrivilegedUserId() {
  if (!PRIVILEGED_USER_ID_ENABLED) return null;
  if (_privilegedUserIdCache) return _privilegedUserIdCache;
  if (_privilegedUserIdPromise) return _privilegedUserIdPromise;
  _privilegedUserIdPromise = (async () => {
    try {
      const id = await getConsistentMachineId("gemini-cli-privileged-user-id");
      _privilegedUserIdCache = id || "";
      return _privilegedUserIdCache;
    } catch {
      _privilegedUserIdCache = "";
      return "";
    } finally {
      _privilegedUserIdPromise = null;
    }
  })();
  return _privilegedUserIdPromise;
}

if (PRIVILEGED_USER_ID_ENABLED) resolvePrivilegedUserId().catch(() => {});

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

  async transformRequest(model, body, stream, credentials) {
    this._currentModel = model;
    if (PRIVILEGED_USER_ID_ENABLED) {
      const v = await resolvePrivilegedUserId();
      _privilegedUserIdCache = v ?? "";
    }
    const work = structuredClone(body);
    const isEnvelope = work && work.request && work.model;
    if (isEnvelope) {
      const request = work.request;
      if (Array.isArray(request.contents)) {
        for (const turn of request.contents) {
          if (!Array.isArray(turn.parts)) continue;
          turn.parts = turn.parts.filter(p => !(p?.thought === true && !p.text && !p.functionCall));
        }
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
      stripOpenAILeakFields(work);
      if (work.request && typeof work.request === "object") {
        stripOpenAILeakFields(work.request);
        delete work.request.user_prompt_id;
      }
      applyIncludeReasoningToGemini(work);
      delete work.include_reasoning;
      return work;
    }

    stripOpenAILeakFields(work);
    applyIncludeReasoningToGemini(work);
    delete work.include_reasoning;
    return {
      project: credentials?.projectId || work?.project,
      model,
      request: work
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

