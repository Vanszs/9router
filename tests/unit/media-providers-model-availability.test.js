import { describe, expect, it } from "vitest";
import { isModelAllowed, buildModelsList } from "../../src/sse/services/allowedModels.js";
import { AI_PROVIDERS, getProviderAlias } from "../../src/shared/constants/providers.js";

describe("Media Providers Model Availability in allowedModels and /v1/models", () => {
  it("allows search model for Antigravity (searchViaChat)", async () => {
    const allowed = await isModelAllowed("ag/search", { id: "test-key" });
    expect(allowed).toBe(true);
  });

  it("allows search model for all providers with searchConfig or searchViaChat", async () => {
    for (const [providerId, provider] of Object.entries(AI_PROVIDERS)) {
      if (provider.searchConfig || provider.searchViaChat || provider.serviceKinds?.includes("webSearch")) {
        const alias = getProviderAlias(providerId) || provider.alias || providerId;
        const searchModelId = `${alias}/search`;
        const allowed = await isModelAllowed(searchModelId, { id: "test-key" });
        expect(allowed, `Expected ${searchModelId} (${providerId}) to be allowed`).toBe(true);
      }
    }
  });

  it("allows fetch model for all providers with fetchConfig", async () => {
    for (const [providerId, provider] of Object.entries(AI_PROVIDERS)) {
      if (provider.fetchConfig || provider.serviceKinds?.includes("webFetch")) {
        const alias = getProviderAlias(providerId) || provider.alias || providerId;
        const fetchModelId = `${alias}/fetch`;
        const allowed = await isModelAllowed(fetchModelId, { id: "test-key" });
        expect(allowed, `Expected ${fetchModelId} (${providerId}) to be allowed`).toBe(true);
      }
    }
  });

  it("allows configured models for all media kinds (tts, stt, image, embedding)", async () => {
    for (const [providerId, provider] of Object.entries(AI_PROVIDERS)) {
      const alias = getProviderAlias(providerId) || provider.alias || providerId;

      if (provider.ttsConfig?.models?.length) {
        for (const m of provider.ttsConfig.models) {
          const allowed = await isModelAllowed(`${alias}/${m.id}`, { id: "test-key" });
          expect(allowed, `Expected TTS ${alias}/${m.id} (${providerId}) to be allowed`).toBe(true);
        }
      }
      if (provider.sttConfig?.models?.length) {
        for (const m of provider.sttConfig.models) {
          const allowed = await isModelAllowed(`${alias}/${m.id}`, { id: "test-key" });
          expect(allowed, `Expected STT ${alias}/${m.id} (${providerId}) to be allowed`).toBe(true);
        }
      }
      if (provider.embeddingConfig?.models?.length) {
        for (const m of provider.embeddingConfig.models) {
          const allowed = await isModelAllowed(`${alias}/${m.id}`, { id: "test-key" });
          expect(allowed, `Expected Embedding ${alias}/${m.id} (${providerId}) to be allowed`).toBe(true);
        }
      }
      if (provider.imageConfig?.models?.length) {
        for (const m of provider.imageConfig.models) {
          const allowed = await isModelAllowed(`${alias}/${m.id}`, { id: "test-key" });
          expect(allowed, `Expected Image ${alias}/${m.id} (${providerId}) to be allowed`).toBe(true);
        }
      }
    }
  });

  it("includes webSearch models in buildModelsList(['webSearch', 'webFetch'])", async () => {
    const list = await buildModelsList(["webSearch", "webFetch"]);
    const ids = list.map((m) => m.id);

    expect(ids).toContain("ag/search");
    expect(ids).toContain("tavily/search");
    expect(ids).toContain("exa/search");
    expect(ids).toContain("brave/search");
    expect(ids).toContain("searxng/search");
    expect(ids).toContain("xquik/search");
    expect(ids).toContain("glm/search");
  });
});
