import { describe, expect, it } from "vitest";
import { estimateInputTokens } from "../../open-sse/utils/usageTracking.js";

describe("estimateInputTokens embedded media", () => {
  it("does not count base64 image bytes as text tokens", () => {
    const small = estimateInputTokens({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] });
    const large = estimateInputTokens({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(1_000_000)}` } }] }] });
    expect(large).toBe(small);
  });
});
