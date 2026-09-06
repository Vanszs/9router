import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnectionsBulk: vi.fn(),
  getProviderNodeById: vi.fn(),
}));

vi.mock("@/models", () => ({
  createProviderConnectionsBulk: mocks.createProviderConnectionsBulk,
  getProviderNodeById: mocks.getProviderNodeById,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const customProvider = "openai-compatible-chat-939bd81d-5bd1-4f40-8da7-34976061eb8c";

function request(provider = customProvider) {
  return new Request("http://localhost/api/providers/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ provider, name: "Bulk Test 1", apiKey: "sk-dummy-not-real", priority: 1 }],
    }),
  });
}

describe("bulk provider route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderNodeById.mockResolvedValue({
      id: customProvider,
      prefix: "bai",
      apiType: "chat",
      baseUrl: "https://api.b.ai/v1",
      name: "bai",
    });
    mocks.createProviderConnectionsBulk.mockResolvedValue([
      { id: "conn-1", provider: customProvider, name: "Bulk Test 1" },
    ]);
  });

  it("accepts custom OpenAI-compatible provider nodes", async () => {
    const { POST } = await import("../../src/app/api/providers/bulk/route.js");
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.createProviderConnectionsBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: customProvider,
        name: "Bulk Test 1",
        apiKey: "sk-dummy-not-real",
        providerSpecificData: {
          prefix: "bai",
          apiType: "chat",
          baseUrl: "https://api.b.ai/v1",
          nodeName: "bai",
        },
      }),
    ]);
  });

  it("rejects custom provider IDs whose node does not exist", async () => {
    mocks.getProviderNodeById.mockResolvedValue(null);
    const { POST } = await import("../../src/app/api/providers/bulk/route.js");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("OpenAI Compatible node not found");
    expect(mocks.createProviderConnectionsBulk).not.toHaveBeenCalled();
  });

  it("rejects unknown providers", async () => {
    const { POST } = await import("../../src/app/api/providers/bulk/route.js");
    const response = await POST(request("not-a-provider"));

    expect(response.status).toBe(400);
    expect(mocks.createProviderConnectionsBulk).not.toHaveBeenCalled();
  });
});
