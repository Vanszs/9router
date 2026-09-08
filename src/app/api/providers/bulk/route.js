import { NextResponse } from "next/server";
import { createProviderConnectionsBulk, getProviderNodeById } from "@/models";
import {
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
} from "@/shared/constants/providers";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { normalizeProviderId } from "@/lib/providerNormalization";

export async function POST(request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 500) {
      return NextResponse.json({ error: "items must contain 1-500 connections" }, { status: 400 });
    }
    const items = body.items.map((item) => ({
      provider: normalizeProviderId(item.provider),
      apiKey: typeof item.apiKey === "string" ? item.apiKey.trim() : "",
      name: typeof item.name === "string" ? item.name.trim() : "",
      priority: Number.isInteger(item.priority) ? item.priority : 1,
      testStatus: "unknown",
      providerSpecificData: item.providerSpecificData,
    }));
    const validProvider = (provider) => APIKEY_PROVIDERS[provider]
      || FREE_TIER_PROVIDERS[provider]
      || WEB_COOKIE_PROVIDERS[provider]
      || isOpenAICompatibleProvider(provider)
      || isAnthropicCompatibleProvider(provider)
      || isCustomEmbeddingProvider(provider);
    if (items.some((item) => !validProvider(item.provider) || !item.apiKey || !item.name)) {
      return NextResponse.json({ error: "Every item requires a valid API-key provider, name, and apiKey" }, { status: 400 });
    }
    const names = new Set();
    for (const item of items) {
      const key = `${item.provider}:${item.name}`;
      if (names.has(key)) {
        return NextResponse.json({ error: "Duplicate provider/name in batch" }, { status: 409 });
      }
      names.add(key);
    }

    const nodes = new Map();
    for (const item of items) {
      const isOpenAI = isOpenAICompatibleProvider(item.provider);
      const isAnthropic = isAnthropicCompatibleProvider(item.provider);
      const isEmbedding = isCustomEmbeddingProvider(item.provider);
      if (!isOpenAI && !isAnthropic && !isEmbedding) continue;

      if (!nodes.has(item.provider)) {
        nodes.set(item.provider, await getProviderNodeById(item.provider));
      }
      const node = nodes.get(item.provider);
      if (!node) {
        const kind = isOpenAI ? "OpenAI Compatible" : isAnthropic ? "Anthropic Compatible" : "Custom Embedding";
        return NextResponse.json({ error: `${kind} node not found` }, { status: 404 });
      }
      item.providerSpecificData = {
        ...(item.providerSpecificData || {}),
        prefix: node.prefix,
        ...(isOpenAI ? { apiType: node.apiType } : {}),
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    const results = await createProviderConnectionsBulk(items);
    return NextResponse.json({ results }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to create provider connections" }, { status: 500 });
  }
}
