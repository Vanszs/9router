// #82 review notes: bucket classification fixtures (Gemini vs Claude/GPT)
// and estimated marker on weekly usage.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  all: vi.fn(),
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => ({ all: mocks.all })),
}));

import { getWeeklyUsage } from "../../open-sse/services/usage/antigravityWeeklyTracker.js";

const isoNow = new Date().toISOString();

describe("antigravity weekly bucket classification", () => {
  it("classifies gemini-* into gemini_weekly with estimated marker", async () => {
    mocks.all.mockReturnValue([
      { model: "gemini-3.6-flash-high", status: "success", timestamp: isoNow },
      { model: "gemini-3-flash-agent", status: "success", timestamp: isoNow },
    ]);
    const result = await getWeeklyUsage("conn-1");
    expect(result.gemini_weekly.used).toBeGreaterThan(0);
    expect(result.gemini_weekly.estimated).toBe(true);
    expect(result.gemini_weekly.isWeekly).toBe(true);
    expect(result.gemini_weekly.displayName).toBe("Gemini Models");
  });

  it("classifies claude-* and gpt-* into claude_gpt_weekly", async () => {
    mocks.all.mockReturnValue([
      { model: "claude-sonnet-4-6", status: "success", timestamp: isoNow },
      { model: "gpt-5.5", status: "success", timestamp: isoNow },
    ]);
    const result = await getWeeklyUsage("conn-1");
    expect(result.claude_gpt_weekly.used).toBeGreaterThan(0);
    expect(result.claude_gpt_weekly.estimated).toBe(true);
    expect(result.claude_gpt_weekly.displayName).toBe("Claude & GPT Models");
  });

  it("skips error rows (they don't consume quota)", async () => {
    mocks.all.mockReturnValue([
      { model: "gemini-3.6-flash-high", status: "error", timestamp: isoNow },
      { model: "claude-sonnet-4-6", status: "failed", timestamp: isoNow },
    ]);
    const result = await getWeeklyUsage("conn-1");
    expect(result.gemini_weekly.used).toBe(0);
    expect(result.claude_gpt_weekly.used).toBe(0);
  });
});
