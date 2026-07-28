import { DefaultExecutor } from "./default.js";
import { randomUUID } from "node:crypto";

export function buildAgentRouterHeaders(apiKey, stream = true) {
  return {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24",
    "anthropic-dangerous-direct-browser-access": "true",
    "x-app": "cli",
    "User-Agent": "claude-cli/2.1.195 (external, sdk-cli)",
    "X-Claude-Code-Session-Id": randomUUID(),
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Timeout": "600",
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": "0.94.0",
    "X-Stainless-OS": "MacOS",
    "X-Stainless-Arch": "arm64",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": "v24.3.0",
    "Accept": stream ? "text/event-stream" : "application/json",
    "accept-encoding": "gzip, deflate, br, zstd",
    ...(apiKey ? { "x-api-key": apiKey } : {})
  };
}

export class AgentRouterExecutor extends DefaultExecutor {
  constructor() {
    super("agentrouter");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Keeps own registry baseUrl + ?beta=true
    return "https://agentrouter.org/v1/messages?beta=true";
  }

  buildHeaders(credentials, stream = true) {
    return buildAgentRouterHeaders(credentials?.apiKey, stream);
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    // Reorder keys according to "claude-code-compatible" bodyFieldOrder:
    // [
    //   "model",
    //   "messages",
    //   "system",
    //   "tools",
    //   "tool_choice",
    //   "metadata",
    //   "max_tokens",
    //   "thinking",
    //   "output_config",
    //   "stream",
    // ]
    const order = [
      "model",
      "messages",
      "system",
      "tools",
      "tool_choice",
      "metadata",
      "max_tokens",
      "thinking",
      "output_config",
      "stream",
    ];

    const reordered = {};
    const remaining = new Set(Object.keys(transformed));

    for (const key of order) {
      if (key in transformed) {
        reordered[key] = transformed[key];
        remaining.delete(key);
      }
    }

    for (const key of remaining) {
      reordered[key] = transformed[key];
    }

    return reordered;
  }
}

export async function validateAgentRouterConnection(apiKey, fetchFn = fetch) {
  const headers = buildAgentRouterHeaders(apiKey, false);

  try {
    const res = await fetchFn("https://agentrouter.org/v1/messages?beta=true", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
        stream: false
      })
    });
    return res.status !== 401 && res.status !== 403;
  } catch (err) {
    return false;
  }
}

export default AgentRouterExecutor;
