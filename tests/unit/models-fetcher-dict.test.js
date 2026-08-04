// Regression: opencode (and other noAuth modelsFetcher providers) pull models
// from https://models.dev/api.json which returns a DICT shape:
//   { "opencode": { "models": { "deepseek-v4-flash-free": {...}, ... } } }
// The old parser only accepted array/`data.data`/array-`data.models`, so the
// dict-shaped `data.models` produced `[]` → no oc/* models in /v1/models.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchModelsFetcherIds } from "../../src/sse/services/allowedModels.js";

describe("fetchModelsFetcherIds", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("handles models.dev dict shape for opencode-free fetcher", async () => {
    const pid = "opencode-dict-test";
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        [pid]: {
          id: pid,
          models: {
            "deepseek-v4-flash-free": { id: "deepseek-v4-flash-free" },
            "ling-3.0-flash-free": { id: "ling-3.0-flash-free" },
            "claude-sonnet-4-6": { id: "claude-sonnet-4-6" },
          },
        },
      }),
    });

    const ids = await fetchModelsFetcherIds(pid, {
      id: pid,
      alias: "oc",
      modelsFetcher: { url: "https://models.dev/api.json", type: "opencode-free" },
    });

    expect(ids).toContain("deepseek-v4-flash-free");
    expect(ids).toContain("ling-3.0-flash-free");
    expect(ids).not.toContain("claude-sonnet-4-6"); // non-free filtered
  });

  it("still supports array shapes", async () => {
    const pid = "generic-array-test";
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ id: "model-a" }, { id: "model-b" }],
    });

    const ids = await fetchModelsFetcherIds(pid, {
      id: pid,
      modelsFetcher: { url: "https://x/models", type: "generic" },
    });

    expect(ids).toContain("model-a");
    expect(ids).toContain("model-b");
  });
});
