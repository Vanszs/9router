// Regression tests for #86 review notes:
// - show only ACL-eligible no-auth providers (not every registered provider)
// - resolve dict payloads by requested provider ID/alias, not first value
// - preserve provider aliases and custom provider-node prefixes
// - keep external model fetches fail-soft with bounded timeout
// - ACL allow/deny behavior for no-auth providers without connections
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildProviderList } from "../../src/shared/utils/aclProviderList.js";
import { fetchModelsFetcherIds } from "../../src/sse/services/allowedModels.js";

describe("buildProviderList (ACL provider list)", () => {
  it("includes connected providers with connection count", () => {
    const list = buildProviderList(
      [
        { provider: "deepseek" },
        { provider: "deepseek" },
        { provider: "antigravity" },
      ],
      [],
      []
    );
    const deepseek = list.find((p) => p.id === "deepseek");
    const ag = list.find((p) => p.id === "antigravity");
    expect(deepseek.count).toBe(2);
    expect(ag.count).toBe(1);
  });

  it("includes registered noAuth providers with zero connections", () => {
    const list = buildProviderList([], [], [
      { id: "opencode", alias: "oc", noAuth: true, displayName: "OpenCode Free" },
      { id: "mimo-free", alias: "mmf", noAuth: true, displayName: "MiMo Code Free" },
    ]);
    expect(list.find((p) => p.id === "opencode")).toMatchObject({
      id: "opencode", alias: "oc", count: 0,
    });
    expect(list.find((p) => p.id === "mimo-free").count).toBe(0);
  });

  it("excludes auth-requiring registered providers with zero connections", () => {
    const list = buildProviderList([], [], [
      { id: "deepseek", alias: "ds", noAuth: false, displayName: "DeepSeek" },
    ]);
    expect(list.find((p) => p.id === "deepseek")).toBeUndefined();
  });

  it("preserves custom provider-node prefixes in display", () => {
    const list = buildProviderList(
      [{ provider: "openai-compatible-chat-abc123" }],
      [{ id: "openai-compatible-chat-abc123", name: "Shiteru", prefix: "st", type: "openai-compatible" }],
      []
    );
    expect(list.find((p) => p.id === "openai-compatible-chat-abc123")).toMatchObject({
      displayName: "Shiteru",
      prefix: "st",
    });
  });

  it("keeps alias when resolving node names", () => {
    const list = buildProviderList(
      [{ provider: "opencode", alias: "oc" }],
      [],
      []
    );
    expect(list.find((p) => p.id === "opencode").alias).toBe("oc");
  });
});

describe("fetchModelsFetcherIds dict resolution", () => {
  const originalFetch = globalThis.fetch;
  let key;
  beforeEach(() => { key = `test-${Math.random()}`; globalThis.fetch = vi.fn(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("resolves multi-provider dict by provider id", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        opencode: { models: { "deepseek-v4-flash-free": { id: "deepseek-v4-flash-free" } } },
        "another-provider": { models: { "not-free": { id: "not-free" } } },
      }),
    });
    const ids = await fetchModelsFetcherIds("opencode", {
      id: "opencode",
      alias: "oc",
      modelsFetcher: { url: "https://models.dev/api.json", type: "opencode-free" },
    });
    expect(ids).toEqual(["deepseek-v4-flash-free"]);
  });

  it("resolves dict by alias when provider id absent", async () => {
    const pid = "opencode-alias-test";
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        oc: { models: { "ling-3.0-flash-free": { id: "ling-3.0-flash-free" } } },
      }),
    });
    const ids = await fetchModelsFetcherIds(pid, {
      id: pid,
      alias: "oc",
      modelsFetcher: { url: "https://models.dev/api.json", type: "opencode-free" },
    });
    expect(ids).toEqual(["ling-3.0-flash-free"]);
  });

  it("returns empty on missing provider key (no first-value fallback)", async () => {
    const pid = "opencode-missing-key-test";
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        "other-provider": { models: { "x-free": { id: "x-free" } } },
      }),
    });
    const ids = await fetchModelsFetcherIds(pid, {
      id: pid,
      alias: "oc",
      modelsFetcher: { url: "https://models.dev/api.json", type: "opencode-free" },
    });
    expect(ids).toEqual([]);
  });

  it("fail-soft on network error returns []", async () => {
    const pid = "opencode-neterr-test";
    globalThis.fetch.mockRejectedValue(new Error("network down"));
    const ids = await fetchModelsFetcherIds(pid, {
      id: pid,
      alias: "oc",
      modelsFetcher: { url: "https://models.dev/api.json", type: "opencode-free" },
    });
    expect(ids).toEqual([]);
  });

  it("fail-soft on non-ok response returns []", async () => {
    const pid = "opencode-nonok-test";
    globalThis.fetch.mockResolvedValue({ ok: false });
    const ids = await fetchModelsFetcherIds(pid, {
      id: pid,
      alias: "oc",
      modelsFetcher: { url: "https://models.dev/api.json", type: "opencode-free" },
    });
    expect(ids).toEqual([]);
  });

  it("uses bounded timeout for fetches", async () => {
    const pid = "opencode-timeout-test";
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await fetchModelsFetcherIds(pid, {
      id: pid,
      alias: "oc",
      modelsFetcher: { url: "https://models.dev/api.json", type: "opencode-free" },
    });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://models.dev/api.json");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
