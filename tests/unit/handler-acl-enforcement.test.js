// Comprehensive ACL enforcement tests for chat and STT handlers.
// Verifies that the handler layer correctly invokes isKindAllowed,
// isProviderAllowed, isComboAllowed, and isModelAllowed and returns
// the right HTTP status codes for every scenario.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  // auth.js
  extractApiKey: vi.fn((req) => {
    const h = req?.headers;
    if (!h?.get) return null;
    const auth = h.get("Authorization");
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return h.get("x-api-key") || null;
  }),
  isValidApiKey: vi.fn(),
  isProviderAllowed: vi.fn(() => true),
  isComboAllowed: vi.fn(() => true),
  isKindAllowed: vi.fn(() => true),
  isTrustedInternalRequest: vi.fn(() => false),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  // allowedModels.js
  isModelAllowed: vi.fn(() => true),
  // localDb
  getSettings: vi.fn(() => Promise.resolve({ requireApiKey: true })),
  // model.js
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(() => Promise.resolve(null)),
  // chatCore
  handleChatCore: vi.fn(() => Promise.resolve({ success: true, response: new Response("ok") })),
  // sttCore
  handleSttCore: vi.fn(() => Promise.resolve({ success: true, response: new Response("ok") })),
  // bypass
  handleBypassRequest: vi.fn(() => null),
  // combo
  handleComboChat: vi.fn(() => new Response("combo-ok")),
  handleFusionChat: vi.fn(() => new Response("fusion-ok")),
  // token refresh
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn((p, c) => Promise.resolve(c)),
  // project id
  getProjectIdForConnection: vi.fn(),
  // logger
  logRequest: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  // claude header cache
  cacheClaudeHeaders: vi.fn(),
  // detect format
  detectFormatByEndpoint: vi.fn(() => null),
  // unavailable response
  unavailableResponse: vi.fn((s, m) => new Response(m, { status: s })),
}));

// ── Register mocks ───────────────────────────────────────────────────
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  isProviderAllowed: mocks.isProviderAllowed,
  isComboAllowed: mocks.isComboAllowed,
  isKindAllowed: mocks.isKindAllowed,
  isTrustedInternalRequest: mocks.isTrustedInternalRequest,
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));

// Also mock relative import path used by the handlers
vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  isProviderAllowed: mocks.isProviderAllowed,
  isComboAllowed: mocks.isComboAllowed,
  isKindAllowed: mocks.isKindAllowed,
  isTrustedInternalRequest: mocks.isTrustedInternalRequest,
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));

vi.mock("@/sse/services/allowedModels.js", () => ({ isModelAllowed: mocks.isModelAllowed }));
vi.mock("../../src/sse/services/allowedModels.js", () => ({ isModelAllowed: mocks.isModelAllowed }));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: vi.fn(() => []),
  validateApiKey: vi.fn(),
  getProviderNodeById: vi.fn(),
  checkApiKeyLimits: vi.fn().mockResolvedValue({ allowed: true }),
  recordApiKeyUsage: vi.fn().mockResolvedValue(undefined),
  getApiKeyUsageSnapshot: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: vi.fn(() => []),
  validateApiKey: vi.fn(),
  getProviderNodeById: vi.fn(),
  checkApiKeyLimits: vi.fn().mockResolvedValue({ allowed: true }),
  recordApiKeyUsage: vi.fn().mockResolvedValue(undefined),
  getApiKeyUsageSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: mocks.getComboModels }));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: mocks.getComboModels }));

vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: mocks.handleSttCore }));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: mocks.handleBypassRequest }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: mocks.handleComboChat,
  handleFusionChat: mocks.handleFusionChat,
  stripComboPrefix: vi.fn((s) => s),
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: mocks.cacheClaudeHeaders }));
vi.mock("open-sse/translator/formats.js", () => ({ detectFormatByEndpoint: mocks.detectFormatByEndpoint }));
vi.mock("open-sse/config/runtimeConfig.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    HTTP_STATUS: { BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, RATE_LIMITED: 429, SERVER_ERROR: 500, BAD_GATEWAY: 502, SERVICE_UNAVAILABLE: 503 },
  };
});
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => new Response(JSON.stringify({ error: { message } }), { status }),
  unavailableResponse: mocks.unavailableResponse,
  withSelectedConnectionHeader: (response) => response,
}));
vi.mock("@/sse/utils/logger.js", () => ({ request: mocks.logRequest, info: mocks.logInfo, warn: mocks.logWarn, debug: mocks.logDebug, maskKey: vi.fn((k) => "***") }));
vi.mock("../../src/sse/utils/logger.js", () => ({ request: mocks.logRequest, info: mocks.logInfo, warn: mocks.logWarn, debug: mocks.logDebug, maskKey: vi.fn((k) => "***") }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: mocks.updateProviderCredentials, checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: mocks.updateProviderCredentials, checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: mocks.getProjectIdForConnection }));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: { whisper: { serviceKinds: ["stt"], sttConfig: { authType: "none" } } },
  resolveProviderId: vi.fn((p) => p),
  FREE_PROVIDERS: {},
  getProviderAlias: vi.fn((p) => p),
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
  isCustomEmbeddingProvider: vi.fn(() => false),
}));
vi.mock("../../src/shared/constants/providers.js", () => ({
  AI_PROVIDERS: { whisper: { serviceKinds: ["stt"], sttConfig: { authType: "none" } } },
  resolveProviderId: vi.fn((p) => p),
  FREE_PROVIDERS: {},
  getProviderAlias: vi.fn((p) => p),
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
  isCustomEmbeddingProvider: vi.fn(() => false),
}));
vi.mock("open-sse/index.js", () => ({}));

// ── Helpers ──────────────────────────────────────────────────────────
function makeChatRequest(model = "openai/gpt-4o", apiKey = "sk-test-key") {
  const headers = new Map();
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  return new Request("http://localhost:3003/v1/chat/completions", {
    method: "POST",
    headers: Object.fromEntries(headers),
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
  });
}

function makeSttRequest(model = "whisper/whisper-1", apiKey = "sk-test-key") {
  const fd = new FormData();
  fd.append("model", model);
  fd.append("file", new Blob(["audio"]), "audio.wav");
  const headers = new Map();
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  return new Request("http://localhost:3003/v1/audio/transcriptions", {
    method: "POST",
    headers: Object.fromEntries(headers),
    body: fd,
  });
}

// ── Test suites ──────────────────────────────────────────────────────
describe("Chat handler ACL enforcement", () => {
  let handleChat;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module registry so the handler re-imports fresh mocks each time
    vi.resetModules();

    // Default happy-path settings
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.isTrustedInternalRequest.mockResolvedValue(false);
    mocks.handleBypassRequest.mockReturnValue(null);
    mocks.getComboModels.mockResolvedValue(null);

    const mod = await import("../../src/sse/handlers/chat.js");
    handleChat = mod.handleChat;
  });

  // ── 1. No API key (requireApiKey=true) ──────────────────────────
  it("returns 401 when no API key provided and requireApiKey=true", async () => {
    const req = makeChatRequest("openai/gpt-4o", null);
    const res = await handleChat(req);
    expect(res.status).toBe(401);
  });

  // ── 2. Invalid API key ──────────────────────────────────────────
  it("returns 401 when API key is invalid", async () => {
    mocks.isValidApiKey.mockResolvedValue(null);
    const req = makeChatRequest("openai/gpt-4o", "sk-bad-key");
    const res = await handleChat(req);
    expect(res.status).toBe(401);
  });

  // ── 3. Kind not allowed → 403 ───────────────────────────────────
  it("returns 403 when LLM kind is not allowed for API key", async () => {
    mocks.isValidApiKey.mockResolvedValue({ id: "k1", allowedKinds: ["embedding"] });
    mocks.isKindAllowed.mockReturnValue(false);
    const req = makeChatRequest("openai/gpt-4o", "sk-test");
    const res = await handleChat(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("not allowed");
  });

  // ── 4. Combo not allowed → 403 ──────────────────────────────────
  it("returns 403 when combo is not allowed for API key", async () => {
    mocks.isValidApiKey.mockResolvedValue({ id: "k1", allowedCombos: [] });
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getComboModels.mockResolvedValue([{ provider: "openai", model: "gpt-4o" }]);
    mocks.isComboAllowed.mockReturnValue(false);
    const req = makeChatRequest("coding-stack", "sk-test");
    const res = await handleChat(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("Combo");
  });

  // ── 5. Provider not allowed → 403 ───────────────────────────────
  it("returns 403 when provider is not allowed for API key", async () => {
    const keyInfo = { id: "k1", allowedProviders: ["glm"] };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.isProviderAllowed.mockResolvedValue(false);
    const req = makeChatRequest("openai/gpt-4o", "sk-test");
    const res = await handleChat(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("Provider");
  });

  // ── 6. Model not allowed → 404 ──────────────────────────────────
  it("returns 404 when model is not in available models list", async () => {
    const keyInfo = { id: "k1", allowedProviders: ["openai"] };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.isProviderAllowed.mockResolvedValue(true);
    mocks.isModelAllowed.mockResolvedValue(false);
    const req = makeChatRequest("openai/gpt-4o", "sk-test");
    const res = await handleChat(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toContain("not available");
  });

  // ── 7. All ACLs pass → proceeds to handleChatCore ───────────────
  it("proceeds to handleChatCore when all ACL checks pass", async () => {
    const keyInfo = { id: "k1", allowedProviders: ["openai"], allowedKinds: ["llm"] };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.isProviderAllowed.mockResolvedValue(true);
    mocks.isModelAllowed.mockResolvedValue(true);
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "c1", connectionName: "main", accessToken: "tok",
    });
    const req = makeChatRequest("openai/gpt-4o", "sk-test");
    const res = await handleChat(req);
    expect(res.status).toBe(200);
    expect(mocks.handleChatCore).toHaveBeenCalledOnce();
  });

  // ── 8. Trusted internal request bypasses ACL ────────────────────
  it("trusted internal request bypasses API key validation; ACL auto-passes with null apiKeyInfo", async () => {
    mocks.isTrustedInternalRequest.mockResolvedValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "c1", connectionName: "main", accessToken: "tok",
    });
    // No API key, but trusted → should pass
    const req = makeChatRequest("openai/gpt-4o", null);
    const res = await handleChat(req);
    expect(res.status).toBe(200);
    // isValidApiKey should NOT be called for trusted requests
    expect(mocks.isValidApiKey).not.toHaveBeenCalled();
    // isKindAllowed IS called but with null apiKeyInfo → returns true (unrestricted)
    expect(mocks.isKindAllowed).toHaveBeenCalledWith(null, "llm");
  });

  // ── 9. requireApiKey=false → no validation at all ──────────────
  it("when requireApiKey=false, skips validation and ACL entirely", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "c1", connectionName: "main", accessToken: "tok",
    });
    const req = makeChatRequest("openai/gpt-4o", null);
    const res = await handleChat(req);
    expect(res.status).toBe(200);
    expect(mocks.isValidApiKey).not.toHaveBeenCalled();
    // apiKeyInfo is null → ACL functions return true by default
    expect(mocks.isKindAllowed).toHaveBeenCalledWith(null, "llm");
  });

  // ── 10. Combo allowed → proceeds to handleComboChat ─────────────
  it("combo request proceeds to handleComboChat when ACL passes", async () => {
    const keyInfo = { id: "k1", allowedCombos: ["coding-stack"], allowedKinds: ["llm"] };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.isComboAllowed.mockReturnValue(true);
    mocks.getComboModels.mockResolvedValue([
      { provider: "openai", model: "gpt-4o" },
      { provider: "anthropic", model: "claude-3" },
    ]);
    const req = makeChatRequest("coding-stack", "sk-test");
    const res = await handleChat(req);
    expect(mocks.handleComboChat).toHaveBeenCalledOnce();
  });

  // ── 11. isKindAllowed called with correct args ──────────────────
  it("isKindAlways called with 'llm' kind for chat requests", async () => {
    const keyInfo = { id: "k1" };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.isProviderAllowed.mockResolvedValue(true);
    mocks.isModelAllowed.mockResolvedValue(true);
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "c1", connectionName: "main", accessToken: "tok",
    });
    const req = makeChatRequest("openai/gpt-4o", "sk-test");
    await handleChat(req);
    expect(mocks.isKindAllowed).toHaveBeenCalledWith(keyInfo, "llm");
  });

  // ── 12. isProviderAllowed called with resolved provider ─────────
  it("isProviderAllowed called with resolved provider name", async () => {
    const keyInfo = { id: "k1", allowedProviders: ["openai"] };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o-mini" });
    mocks.isProviderAllowed.mockResolvedValue(true);
    mocks.isModelAllowed.mockResolvedValue(true);
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "c1", connectionName: "main", accessToken: "tok",
    });
    const req = makeChatRequest("openai/gpt-4o-mini", "sk-test");
    await handleChat(req);
    expect(mocks.isProviderAllowed).toHaveBeenCalledWith(keyInfo, "openai");
  });

  // ── 13. isModelAllowed called with resolved model string ───────
  it("isModelAllowed called with provider/model string", async () => {
    const keyInfo = { id: "k1" };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "anthropic", model: "claude-3-sonnet" });
    mocks.isProviderAllowed.mockResolvedValue(true);
    mocks.isModelAllowed.mockResolvedValue(true);
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "c1", connectionName: "main", accessToken: "tok",
    });
    const req = makeChatRequest("anthropic/claude-3-sonnet", "sk-test");
    await handleChat(req);
    expect(mocks.isModelAllowed).toHaveBeenCalledWith("anthropic/claude-3-sonnet", keyInfo);
  });

  // ── 14. Empty allowedKinds=[] blocks all ─────────────────────────
  it("empty allowedKinds=[] blocks chat requests", async () => {
    const keyInfo = { id: "k1", allowedKinds: [] };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(false);
    const req = makeChatRequest("openai/gpt-4o", "sk-test");
    const res = await handleChat(req);
    expect(res.status).toBe(403);
  });

  // ── 15. Empty allowedProviders=[] blocks all providers ──────────
  it("empty allowedProviders=[] blocks all provider access", async () => {
    const keyInfo = { id: "k1", allowedProviders: [] };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    mocks.isProviderAllowed.mockResolvedValue(false);
    const req = makeChatRequest("openai/gpt-4o", "sk-test");
    const res = await handleChat(req);
    expect(res.status).toBe(403);
  });

  // ── 16. Missing model in body → 400 ────────────────────────────
  it("returns 400 when model is missing from body", async () => {
    mocks.isValidApiKey.mockResolvedValue({ id: "k1" });
    mocks.isKindAllowed.mockReturnValue(true);
    const headers = { Authorization: "Bearer sk-test" };
    const req = new Request("http://localhost:3003/v1/chat/completions", {
      method: "POST", headers,
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await handleChat(req);
    expect(res.status).toBe(400);
  });
});

describe("STT handler ACL enforcement", () => {
  let handleStt;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.isTrustedInternalRequest.mockResolvedValue(false);

    const mod = await import("../../src/sse/handlers/stt.js");
    handleStt = mod.handleStt;
  });

  // ── 1. No API key → 401 ────────────────────────────────────────
  it("returns 401 when no API key provided", async () => {
    const req = makeSttRequest("whisper/whisper-1", null);
    const res = await handleStt(req);
    expect(res.status).toBe(401);
  });

  // ── 2. Invalid API key → 401 ───────────────────────────────────
  it("returns 401 when API key is invalid", async () => {
    mocks.isValidApiKey.mockResolvedValue(null);
    const req = makeSttRequest("whisper/whisper-1", "sk-bad");
    const res = await handleStt(req);
    expect(res.status).toBe(401);
  });

  // ── 3. STT kind not allowed → 403 ──────────────────────────────
  it("returns 403 when STT kind is not allowed", async () => {
    mocks.isValidApiKey.mockResolvedValue({ id: "k1", allowedKinds: ["llm"] });
    mocks.isKindAllowed.mockReturnValue(false);
    const req = makeSttRequest("whisper/whisper-1", "sk-test");
    const res = await handleStt(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("STT");
  });

  // ── 4. Provider not allowed → 403 ──────────────────────────────
  it("returns 403 when provider is not allowed", async () => {
    const keyInfo = { id: "k1", allowedProviders: ["openai"] };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "whisper", model: "whisper-1" });
    mocks.isProviderAllowed.mockResolvedValue(false);
    const req = makeSttRequest("whisper/whisper-1", "sk-test");
    const res = await handleStt(req);
    expect(res.status).toBe(403);
  });

  // ── 5. Model not allowed → 404 ──────────────────────────────────
  it("returns 404 when model is not available", async () => {
    const keyInfo = { id: "k1" };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "whisper", model: "whisper-1" });
    mocks.isProviderAllowed.mockResolvedValue(true);
    mocks.isModelAllowed.mockResolvedValue(false);
    const req = makeSttRequest("whisper/whisper-1", "sk-test");
    const res = await handleStt(req);
    expect(res.status).toBe(404);
  });

  // ── 6. All ACLs pass → proceeds ────────────────────────────────
  it("proceeds to handleSttCore when all ACL checks pass", async () => {
    const keyInfo = { id: "k1" };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "whisper", model: "whisper-1" });
    mocks.isProviderAllowed.mockResolvedValue(true);
    mocks.isModelAllowed.mockResolvedValue(true);
    const req = makeSttRequest("whisper/whisper-1", "sk-test");
    const res = await handleStt(req);
    expect(mocks.handleSttCore).toHaveBeenCalledOnce();
  });

  // ── 7. Trusted internal bypasses ACL ───────────────────────────
  it("trusted internal request bypasses validation; ACL auto-passes with null apiKeyInfo", async () => {
    mocks.isTrustedInternalRequest.mockResolvedValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "whisper", model: "whisper-1" });
    const req = makeSttRequest("whisper/whisper-1", null);
    const res = await handleStt(req);
    expect(mocks.isValidApiKey).not.toHaveBeenCalled();
    // isKindAllowed IS called but with null → unrestricted
    expect(mocks.isKindAllowed).toHaveBeenCalledWith(null, "stt");
  });

  // ── 8. isKindAllowed called with "stt" ─────────────────────────
  it("isKindAllowed called with 'stt' kind", async () => {
    const keyInfo = { id: "k1" };
    mocks.isValidApiKey.mockResolvedValue(keyInfo);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: "whisper", model: "whisper-1" });
    mocks.isProviderAllowed.mockResolvedValue(true);
    mocks.isModelAllowed.mockResolvedValue(true);
    const req = makeSttRequest("whisper/whisper-1", "sk-test");
    await handleStt(req);
    expect(mocks.isKindAllowed).toHaveBeenCalledWith(keyInfo, "stt");
  });

  // ── 9. Missing model → 400 ────────────────────────────────────
  it("returns 400 when model is missing", async () => {
    mocks.isValidApiKey.mockResolvedValue({ id: "k1" });
    mocks.isKindAllowed.mockReturnValue(true);
    const fd = new FormData();
    fd.append("file", new Blob(["audio"]), "audio.wav");
    const req = new Request("http://localhost:3003/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer sk-test" },
      body: fd,
    });
    const res = await handleStt(req);
    expect(res.status).toBe(400);
  });

  // ── 10. Invalid model format → 400 ────────────────────────────
  it("returns 400 for invalid model format", async () => {
    mocks.isValidApiKey.mockResolvedValue({ id: "k1" });
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getModelInfo.mockResolvedValue({ provider: null, model: null });
    const req = makeSttRequest("???", "sk-test");
    const res = await handleStt(req);
    expect(res.status).toBe(400);
  });
});

describe("ACL function tri-state semantics (inline, hermetic)", () => {
  // Re-implement ACL functions here (matching src/sse/services/auth.js exactly)
  // to keep tests hermetic and avoid the complex DB import chain.
  // This pattern matches the existing apikey-acl-security.test.js convention.
  function isKindAllowed(apiKeyInfo, kind) {
    if (!apiKeyInfo) return true;
    const allowed = apiKeyInfo.allowedKinds;
    if (allowed === null || allowed === undefined) return true;
    if (!Array.isArray(allowed) || allowed.length === 0) return false;
    return allowed.includes(kind);
  }
  function isComboAllowed(apiKeyInfo, comboName) {
    if (!apiKeyInfo) return true;
    const name = comboName.startsWith("combo/") ? comboName.slice(6) : comboName;
    const allowed = apiKeyInfo.allowedCombos;
    if (allowed === null || allowed === undefined) return true;
    if (!Array.isArray(allowed) || allowed.length === 0) return false;
    return allowed.includes(name);
  }
  async function isProviderAllowed(apiKeyInfo, providerIdOrAlias) {
    if (!apiKeyInfo) return true;
    const allowed = apiKeyInfo.allowedProviders;
    if (allowed === null || allowed === undefined) return true;
    if (!Array.isArray(allowed) || allowed.length === 0) return false;
    return allowed.includes(providerIdOrAlias);
  }

  const KINDS = ["llm", "embedding", "image", "tts", "stt", "web"];
  const PROVIDERS = ["openai", "anthropic", "glm", "minimax", "kiro", "gemini-cli"];
  const COMBOS = ["coding-stack", "free-forever", "premium-stack"];

  it("null apiKeyInfo → all allowed (unrestricted)", async () => {
    for (const k of KINDS) expect(isKindAllowed(null, k)).toBe(true);
    for (const c of COMBOS) expect(isComboAllowed(null, c)).toBe(true);
    for (const p of PROVIDERS) expect(await isProviderAllowed(null, p)).toBe(true);
  });

  it("allowedX=null → all allowed", async () => {
    expect(isKindAllowed({ allowedKinds: null }, "llm")).toBe(true);
    expect(isComboAllowed({ allowedCombos: null }, "any")).toBe(true);
    expect(await isProviderAllowed({ allowedProviders: null }, "any")).toBe(true);
  });

  it("allowedX=undefined → all allowed", async () => {
    expect(isKindAllowed({ allowedKinds: undefined }, "llm")).toBe(true);
    expect(isComboAllowed({ allowedCombos: undefined }, "any")).toBe(true);
    expect(await isProviderAllowed({ allowedProviders: undefined }, "any")).toBe(true);
  });

  it("allowedX=[] → none allowed (complete lockdown)", async () => {
    for (const k of KINDS) expect(isKindAllowed({ allowedKinds: [] }, k)).toBe(false);
    for (const c of COMBOS) expect(isComboAllowed({ allowedCombos: [] }, c)).toBe(false);
    for (const p of PROVIDERS) expect(await isProviderAllowed({ allowedProviders: [] }, p)).toBe(false);
  });

  it("selective allow list works correctly", async () => {
    expect(isKindAllowed({ allowedKinds: ["llm", "embedding"] }, "llm")).toBe(true);
    expect(isKindAllowed({ allowedKinds: ["llm", "embedding"] }, "embedding")).toBe(true);
    expect(isKindAllowed({ allowedKinds: ["llm", "embedding"] }, "image")).toBe(false);

    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "coding-stack")).toBe(true);
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "free-forever")).toBe(false);

    expect(await isProviderAllowed({ allowedProviders: ["openai"] }, "openai")).toBe(true);
    expect(await isProviderAllowed({ allowedProviders: ["openai"] }, "anthropic")).toBe(false);
  });

  it("combo/ prefix is stripped before matching", () => {
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "combo/coding-stack")).toBe(true);
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "combo/free-forever")).toBe(false);
  });

  it("case-sensitive matching for all ACL fields", async () => {
    expect(isKindAllowed({ allowedKinds: ["LLM"] }, "llm")).toBe(false);
    expect(isComboAllowed({ allowedCombos: ["Coding-Stack"] }, "coding-stack")).toBe(false);
    expect(await isProviderAllowed({ allowedProviders: ["OpenAI"] }, "openai")).toBe(false);
  });

  it("apiKeyInfo with no ACL fields → unrestricted (safe default)", async () => {
    const key = { id: "k1", name: "test" };
    expect(isKindAllowed(key, "llm")).toBe(true);
    expect(isComboAllowed(key, "any-combo")).toBe(true);
    expect(await isProviderAllowed(key, "any-provider")).toBe(true);
  });

  it("all 6 kinds are individually enforceable", () => {
    for (const kind of KINDS) {
      const key = { allowedKinds: [kind] };
      expect(isKindAllowed(key, kind)).toBe(true);
      for (const other of KINDS.filter((k) => k !== kind)) {
        expect(isKindAllowed(key, other)).toBe(false);
      }
    }
  });
});

describe("Cross-handler ACL consistency", () => {
  // Verifies that the ACL enforcement pattern is identical across
  // chat, STT, and the already-tested handlers (embeddings, etc.)

  it("chat handler blocks before provider resolution when kind is not allowed", async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-register mocks after resetModules
    mocks.isKindAllowed.mockReturnValue(false);
    mocks.isValidApiKey.mockResolvedValue({ id: "k1", allowedKinds: [] });
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.isTrustedInternalRequest.mockResolvedValue(false);
    mocks.handleBypassRequest.mockReturnValue(null);
    mocks.getComboModels.mockResolvedValue(null);

    const chatMod = await import("../../src/sse/handlers/chat.js");
    const chatReq = makeChatRequest("openai/gpt-4o", "sk-test");
    const chatRes = await chatMod.handleChat(chatReq);
    expect(chatRes.status).toBe(403);
    // Should NOT resolve model info if kind is blocked
    expect(mocks.getModelInfo).not.toHaveBeenCalled();
  });

  it("STT handler blocks before provider resolution when kind is not allowed", async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-register mocks after resetModules
    mocks.isKindAllowed.mockReturnValue(false);
    mocks.isValidApiKey.mockResolvedValue({ id: "k1", allowedKinds: [] });
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.isTrustedInternalRequest.mockResolvedValue(false);

    const sttMod = await import("../../src/sse/handlers/stt.js");
    const sttReq = makeSttRequest("whisper/whisper-1", "sk-test");
    const sttRes = await sttMod.handleStt(sttReq);
    expect(sttRes.status).toBe(403);
    expect(mocks.getModelInfo).not.toHaveBeenCalled();
  });
});
