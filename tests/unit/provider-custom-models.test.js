import { describe, expect, it } from "vitest";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels.js";

describe("provider custom model rows", () => {
  it("keeps identical model IDs separate per provider", () => {
    const customModels = [
      { providerAlias: "ollama", id: "minimax-m2.5", type: "llm", name: "MiniMax M2.5" },
      { providerAlias: "opencode-go", id: "minimax-m2.5", type: "llm", name: "MiniMax M2.5" },
    ];

    expect(getProviderCustomModelRows({ customModels, providerAlias: "ollama" })).toEqual([
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5",
        fullModel: "ollama/minimax-m2.5",
        source: "custom",
        type: "llm",
      },
    ]);
    expect(getProviderCustomModelRows({ customModels, providerAlias: "opencode-go" })).toEqual([
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5",
        fullModel: "opencode-go/minimax-m2.5",
        source: "custom",
        type: "llm",
      },
    ]);
  });

  it("keeps legacy alias-backed models visible without duplicating custom models", () => {
    const rows = getProviderCustomModelRows({
      customModels: [
        { providerAlias: "ollama", id: "custom-a", type: "llm", name: "Custom A" },
      ],
      modelAliases: {
        "custom-a": "ollama/custom-a",
        "legacy-b": "ollama/legacy-b",
        "other-provider": "opencode-go/legacy-b",
      },
      providerAlias: "ollama",
    });

    expect(rows).toEqual([
      {
        id: "custom-a",
        name: "Custom A",
        fullModel: "ollama/custom-a",
        source: "custom",
        type: "llm",
      },
      {
        id: "legacy-b",
        alias: "legacy-b",
        fullModel: "ollama/legacy-b",
        source: "legacyAlias",
        type: "llm",
      },
    ]);
  });

  it("filters built-in models and typed custom models", () => {
    const rows = getProviderCustomModelRows({
      customModels: [
        { providerAlias: "ollama", id: "llama3", type: "llm", name: "Llama 3" },
        { providerAlias: "ollama", id: "custom-image", type: "image", name: "Custom Image" },
        { providerAlias: "ollama", id: "custom-llm", type: "llm", name: "Custom LLM" },
      ],
      providerAlias: "ollama",
      builtInModels: [{ id: "llama3" }],
      type: "llm",
    });

    expect(rows).toEqual([
      {
        id: "custom-llm",
        name: "Custom LLM",
        fullModel: "ollama/custom-llm",
        source: "custom",
        type: "llm",
      },
    ]);
  });

  it("adds custom models in bulk atomically", async () => {
    const { addCustomModelsBulk, getCustomModels, deleteCustomModel } = await import("@/lib/db/index.js");
    const testModels = [
      { providerAlias: "test-bulk-prov", id: "bulk-m1", type: "llm" },
      { providerAlias: "test-bulk-prov", id: "bulk-m2", type: "llm" },
    ];
    const count = await addCustomModelsBulk(testModels);
    expect(count).toBe(2);

    const all = await getCustomModels();
    const found1 = all.find((m) => m.providerAlias === "test-bulk-prov" && m.id === "bulk-m1");
    const found2 = all.find((m) => m.providerAlias === "test-bulk-prov" && m.id === "bulk-m2");
    expect(found1).toBeDefined();
    expect(found2).toBeDefined();

    // Clean up
    await deleteCustomModel({ providerAlias: "test-bulk-prov", id: "bulk-m1", type: "llm" });
    await deleteCustomModel({ providerAlias: "test-bulk-prov", id: "bulk-m2", type: "llm" });
  });
});
