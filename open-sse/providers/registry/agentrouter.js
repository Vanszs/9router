// AgentRouter — multi-model routing gateway.
// Config aligned with OmniRoute: Claude format, x-api-key auth,
// full Claude CLI header spoofing (required by AgentRouter for auth).
// Passthrough provider: accepts any model ID, no fixed model list.
// Free tier: $200 credits on signup, no credit card required.

export default {
  id: "agentrouter",
  alias: "agentrouter",
  uiAlias: "agentrouter",
  display: {
    name: "AgentRouter",
    icon: "router",
    color: "#10B981",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      apiHint: "Get $200 free credits at https://agentrouter.org/register — no credit card required.",
      text: "Get $200 free credits at https://agentrouter.org/register — no credit card required.",
      apiKeyUrl: "https://agentrouter.org/register",
    },
  },
  category: "freeTier",
  authType: "apikey",
  hasOAuth: false,
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    timeoutMs: 600000,
    auth: {
      apiKey: {
        header: "x-api-key",
        scheme: "raw",
      },
    },
    forceStream: true,
    preserveAccept: true,
    retry: {
      429: { attempts: 3, delayMs: 500 },
      502: { attempts: 3, delayMs: 500 },
      503: { attempts: 3, delayMs: 1000 },
    },
  },
  models: [
    { id: "claude-opus-4-6", name: "Claude 4.6 Opus" },
    { id: "claude-opus-4-8", name: "Claude 4.8 Opus" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "gpt-5.5", name: "GPT 5.5" },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
    { id: "kimi-k3", name: "Kimi K3" },
  ],
  passthroughModels: true,
};
