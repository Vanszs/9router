// Regression test: Shiteru / OpenAI-compatible passthrough on large prompts
// returns a finish chunk with completion_tokens: 0 despite real streamed
// content ("estimated": true, output estimation failed upstream).
// hasValidUsage() alone treats this as valid because prompt_tokens > 0, so
// the router must detect and patch the zero-completion case separately.
import { describe, it, expect } from "vitest";
import {
  hasValidUsage,
  hasZeroCompletionWithContent,
  fixZeroCompletionUsage,
} from "../../open-sse/utils/usageTracking.js";

describe("hasZeroCompletionWithContent", () => {
  it("flags OpenAI-shape usage with completion_tokens: 0 when content was streamed", () => {
    const usage = { prompt_tokens: 182812, completion_tokens: 0, total_tokens: 182812, estimated: true };
    expect(hasValidUsage(usage)).toBe(true); // this is exactly the trap: passes hasValidUsage
    expect(hasZeroCompletionWithContent(usage, 1200)).toBe(true);
  });

  it("flags Claude-shape usage with output_tokens: 0 when content was streamed", () => {
    const usage = { input_tokens: 50000, output_tokens: 0 };
    expect(hasZeroCompletionWithContent(usage, 500)).toBe(true);
  });

  it("does not flag when completion_tokens is legitimately non-zero", () => {
    const usage = { prompt_tokens: 1000, completion_tokens: 42, total_tokens: 1042 };
    expect(hasZeroCompletionWithContent(usage, 200)).toBe(false);
  });

  it("does not flag zero completion_tokens when no content was actually streamed", () => {
    const usage = { prompt_tokens: 1000, completion_tokens: 0 };
    expect(hasZeroCompletionWithContent(usage, 0)).toBe(false);
  });

  it("returns false for null/undefined usage", () => {
    expect(hasZeroCompletionWithContent(null, 500)).toBe(false);
    expect(hasZeroCompletionWithContent(undefined, 500)).toBe(false);
  });
});

describe("fixZeroCompletionUsage", () => {
  it("patches OpenAI-shape usage: keeps prompt_tokens, estimates completion_tokens, recomputes total", () => {
    const usage = { prompt_tokens: 182812, completion_tokens: 0, total_tokens: 182812, estimated: true };
    const fixed = fixZeroCompletionUsage(usage, 1200); // ~300 estimated tokens (1200/4)
    expect(fixed.prompt_tokens).toBe(182812); // provider's real input count preserved
    expect(fixed.completion_tokens).toBe(300);
    expect(fixed.total_tokens).toBe(183112);
    expect(fixed.estimated).toBe(true);
    expect(hasValidUsage(fixed)).toBe(true);
  });

  it("patches Claude-shape usage: keeps input_tokens, estimates output_tokens", () => {
    const usage = { input_tokens: 50000, output_tokens: 0 };
    const fixed = fixZeroCompletionUsage(usage, 400); // 100 estimated tokens
    expect(fixed.input_tokens).toBe(50000);
    expect(fixed.output_tokens).toBe(100);
  });

  it("minimum 1 estimated output token when content is non-empty", () => {
    const usage = { prompt_tokens: 100, completion_tokens: 0 };
    const fixed = fixZeroCompletionUsage(usage, 1); // 1 char -> floor(1/4)=0, but min 1
    expect(fixed.completion_tokens).toBeGreaterThanOrEqual(1);
  });
});
