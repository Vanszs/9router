// Verify the pre-credential circuit breaker in chat.js returns a valid
// Retry-After header when the provider is fully blocked.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  extractApiKey: vi.fn((req) => {
    const auth = req?.headers?.get?.("Authorization");
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return req?.headers?.get?.("x-api-key") || null;
  }),
  isValidApiKey: vi.fn(() => true),
  isProviderAllowed: vi.fn(() => true),
  isComboAllowed: vi.fn(() => true),
  isKindAllowed: vi.fn(() => true),
  isTrustedInternalRequest: vi.fn(() => false),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  isModelAllowed: vi.fn(() => true),
  getSettings: vi.fn(() => Promise.resolve({ requireApiKey: true })),
  getModelInfo: vi.fn((model) => Promise.resolve({ provider: "openai", model })),
  getComboModels: vi.fn(() => Promise.resolve(null)),
  handleChatCore: vi.fn(() => Promise.resolve({ success: true, response: new Response("ok") })),
  handleBypassRequest: vi.fn(() => null),
  handleComboChat: vi.fn(() => new Response("combo-ok")),
  handleFusionChat: vi.fn(() => new Response("fusion-ok")),
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn((_p, c) => Promise.resolve(c)),
  getProjectIdForConnection: vi.fn(),
  logRequest: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  cacheClaudeHeaders: vi.fn(),
  detectFormatByEndpoint: vi.fn(() => null),
  isProviderFullyBlocked: vi.fn(() => false),
  getProviderShortestCooldownMs: vi.fn(() => 0),
  recordProviderFailure: vi.fn(),
  clearProviderFailure: vi.fn(),
  clearProviderFailureDedup: vi.fn(),
}));

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

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: mocks.handleBypassRequest }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: mocks.handleComboChat,
  handleFusionChat: mocks.handleFusionChat,
  stripComboPrefix: vi.fn((s) => s),
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: mocks.cacheClaudeHeaders }));
vi.mock("open-sse/translator/formats.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    detectFormatByEndpoint: mocks.detectFormatByEndpoint,
  };
});
vi.mock("open-sse/services/accountFallback.js", () => ({
  isProviderFullyBlocked: mocks.isProviderFullyBlocked,
  getProviderShortestCooldownMs: mocks.getProviderShortestCooldownMs,
  recordProviderFailure: mocks.recordProviderFailure,
  clearProviderFailure: mocks.clearProviderFailure,
  clearProviderFailureDedup: mocks.clearProviderFailureDedup,
  checkFallbackError: vi.fn(() => ({ shouldFallback: true, cooldownMs: 5000 })),
  formatRetryAfter: vi.fn(() => "reset after 5s"),
}));
vi.mock("open-sse/utils/circuitBreaker.js", () => ({
  resetAllCircuitBreakers: vi.fn(),
}));
vi.mock("open-sse/config/runtimeConfig.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    HTTP_STATUS: {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      RATE_LIMITED: 429,
      SERVER_ERROR: 500,
      BAD_GATEWAY: 502,
      SERVICE_UNAVAILABLE: 503,
    },
  };
});
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://localhost:9999" }));
vi.mock("@/lib/updater/updater", () => ({ checkForUpdates: vi.fn() }));
vi.mock("@/lib/oauth/providers", () => ({ getOAuthClient: vi.fn() }));

const { POST } = await import("../../src/app/api/v1/chat/completions/route.js");

describe("chat pre-credential circuit breaker Retry-After", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidApiKey.mockReturnValue(true);
    mocks.isProviderAllowed.mockReturnValue(true);
    mocks.isModelAllowed.mockReturnValue(true);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
  });

  it("returns Retry-After header matching the shortest cooldown when provider is fully blocked", async () => {
    const cooldownMs = 25_000;
    mocks.isProviderFullyBlocked.mockReturnValue(true);
    mocks.getProviderShortestCooldownMs.mockReturnValue(cooldownMs);

    const request = new Request("http://localhost/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-key",
      },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    const retryAfter = response.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    const retryAfterSec = parseInt(retryAfter, 10);
    expect(retryAfterSec).toBeGreaterThanOrEqual(24);
    expect(retryAfterSec).toBeLessThanOrEqual(26);

    // getProviderCredentials should NOT be called because the gate short-circuits.
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
});
