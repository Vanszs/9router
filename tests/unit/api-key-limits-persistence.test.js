import { describe, it, expect, beforeEach } from "vitest";
import { getAdapter } from "@/lib/db/driver.js";
import {
  createApiKey,
  getApiKeyById,
  updateApiKey,
  deleteApiKey,
  validateApiKey,
} from "@/lib/db/repos/apiKeysRepo.js";
import {
  checkApiKeyLimits,
  recordApiKeyUsage,
  getApiKeyUsageSnapshot,
} from "@/lib/db/repos/apiKeyUsageRepo.js";
import { isModelAllowed } from "@/sse/services/auth.js";

describe("API Key Limits & Usage Repository (SQLite-backed)", () => {
  let db;

  beforeEach(async () => {
    db = await getAdapter();
    db.run("DELETE FROM apiKeys");
    db.run("DELETE FROM apiKeyUsageBuckets");
    db.run("DELETE FROM apiKeyTokenEvents");
  });

  it("creates and retrieves an API key with limits and allowedModels", async () => {
    const key = await createApiKey("Test Key", "machine-123", {
      rpm: 10,
      rph: 100,
      rpd: 500,
      maxTokens: 4096,
      maxTokensDaily: 50000,
      tokens5h: 20000,
      tokensWeekly: 200000,
      tokensMonthly: 1000000,
      allowedModels: ["claude-3-5-sonnet-*", "gpt-4o"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    expect(key.name).toBe("Test Key");
    expect(key.rpm).toBe(10);
    expect(key.rph).toBe(100);
    expect(key.rpd).toBe(500);
    expect(key.maxTokens).toBe(4096);
    expect(key.maxTokensDaily).toBe(50000);
    expect(key.tokens5h).toBe(20000);
    expect(key.allowedModels).toEqual(["claude-3-5-sonnet-*", "gpt-4o"]);

    const fetched = await getApiKeyById(key.id);
    expect(fetched.rpm).toBe(10);
    expect(fetched.allowedModels).toEqual(["claude-3-5-sonnet-*", "gpt-4o"]);
  });

  it("enforces expiration date on validateApiKey and checkApiKeyLimits", async () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    const expiredKey = await createApiKey("Expired", "machine-123", {
      expiresAt: pastDate,
    });

    const valid = await validateApiKey(expiredKey.key);
    expect(valid).toBeNull();

    const check = await checkApiKeyLimits(expiredKey, 0);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("expired");
  });

  it("enforces allowedModels matching with exact and wildcard support", () => {
    const keyInfo = {
      allowedModels: ["claude-3-5-sonnet-*", "gpt-4o", "antigravity/gemini-2.5*"],
    };

    expect(isModelAllowed(keyInfo, "claude-3-5-sonnet-20241022")).toBe(true);
    expect(isModelAllowed(keyInfo, "claude-3-5-sonnet-latest")).toBe(true);
    expect(isModelAllowed(keyInfo, "gpt-4o")).toBe(true);
    expect(isModelAllowed(keyInfo, "antigravity/gemini-2.5-flash")).toBe(true);

    expect(isModelAllowed(keyInfo, "claude-3-opus-20240229")).toBe(false);
    expect(isModelAllowed(keyInfo, "gpt-4o-mini")).toBe(false);
    expect(isModelAllowed(keyInfo, "deepseek-r1")).toBe(false);
  });

  it("atomically enforces RPM and RPH rate limits", async () => {
    const key = await createApiKey("Rate Limited Key", "machine-123", {
      rpm: 2,
    });

    // 1st request admission & reservation
    const check1 = await checkApiKeyLimits(key, 100, true);
    expect(check1.allowed).toBe(true);

    // 2nd request admission & reservation
    const check2 = await checkApiKeyLimits(key, 100, true);
    expect(check2.allowed).toBe(true);

    // 3rd request should be blocked
    const check3 = await checkApiKeyLimits(key, 100, true);
    expect(check3.allowed).toBe(false);
    expect(check3.reason).toContain("requests per minute");
    expect(check3.retryAfterMs).toBeGreaterThan(0);
  });

  it("atomically tracks token usage across rolling windows and snapshots", async () => {
    const key = await createApiKey("Token Limited Key", "machine-123", {
      maxTokensDaily: 1000,
      tokens5h: 500,
    });

    // Record usage
    await recordApiKeyUsage(key, 300);

    let snapshot = await getApiKeyUsageSnapshot(key);
    expect(snapshot.maxTokensDaily.used).toBe(300);
    expect(snapshot.tokens5h.used).toBe(300);
    expect(snapshot.rpm.used).toBe(1);

    // Admission for 150 tokens should pass (300 + 150 <= 500)
    const check1 = await checkApiKeyLimits(key, 150);
    expect(check1.allowed).toBe(true);

    // Admission for 250 tokens should fail 5h rolling limit (300 + 250 > 500)
    const check2 = await checkApiKeyLimits(key, 250);
    expect(check2.allowed).toBe(false);
    expect(check2.reason).toContain("5-hour rolling token window");
  });

  it("deletes usage records cascading when key is deleted", async () => {
    const key = await createApiKey("To Delete", "machine-123", { rpm: 5 });
    await recordApiKeyUsage(key, 500);

    const deleted = await deleteApiKey(key.id);
    expect(deleted).toBe(true);

    const buckets = db.all("SELECT * FROM apiKeyUsageBuckets WHERE keyId = ?", [key.id]);
    expect(buckets.length).toBe(0);

    const events = db.all("SELECT * FROM apiKeyTokenEvents WHERE keyId = ?", [key.id]);
    expect(events.length).toBe(0);
  });
});
