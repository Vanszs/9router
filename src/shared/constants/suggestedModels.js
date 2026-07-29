// Curated "suggested" models for providers that don't expose a public
// modelsFetcher endpoint. Surfaced in the provider page's
// "Suggested free models" section so users can one-click add them.
//
// Keyed by providerId. Each entry: { id, name }.
// NVIDIA NIM: all listed models are free for NVIDIA Developer Program members
// (prototyping/testing). Verified callable against integrate.api.nvidia.com
// (in the /v1/models catalog AND returning 200 on a real completion) — models
// that are catalog-listed but 404 "not found for account" (e.g. kimi-k2.6,
// qwen3.5-397b) or EOL/410 (e.g. glm-5.1) are intentionally excluded.
export const SUGGESTED_MODELS = {
  nvidia: [
    { id: "z-ai/glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "minimaxai/minimax-m3", name: "MiniMax M3" },
    { id: "qwen/qwen3-next-80b-a3b-instruct", name: "Qwen3 Next 80B A3B" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
    { id: "meta/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick 17B" },
    { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super 120B" },
    { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", name: "Nemotron Super 49B v1.5" },
    { id: "stepfun-ai/step-3.7-flash", name: "Step 3.7 Flash" },
  ],
};
