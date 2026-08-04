// #67 review notes: deterministic tests for proxy rotation selector +
// connection-level precedence, invalid-pool filtering, relay fields.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pickProxyPoolId } from "../../src/lib/network/connectionProxy.js";

describe("pickProxyPoolId (rotation selector)", () => {
  it("returns null for empty pools", () => {
    expect(pickProxyPoolId([], "round-robin", "p1")).toBeNull();
    expect(pickProxyPoolId([], "random", "p1")).toBeNull();
    expect(pickProxyPoolId([], "none", "p1")).toBeNull();
  });

  it("returns null for non-array input", () => {
    expect(pickProxyPoolId(undefined, "round-robin", "p1")).toBeNull();
    expect(pickProxyPoolId("abc", "round-robin", "p1")).toBeNull();
  });

  it("round-robin cycles deterministically", () => {
    const pools = ["a", "b", "c"];
    expect(pickProxyPoolId(pools, "round-robin", "prov1")).toBe("a");
    expect(pickProxyPoolId(pools, "round-robin", "prov1")).toBe("b");
    expect(pickProxyPoolId(pools, "round-robin", "prov1")).toBe("c");
    expect(pickProxyPoolId(pools, "round-robin", "prov1")).toBe("a");
  });

  it("round-robin state is per-provider", () => {
    const pools = ["a", "b"];
    expect(pickProxyPoolId(pools, "round-robin", "provA")).toBe("a");
    expect(pickProxyPoolId(pools, "round-robin", "provB")).toBe("a"); // independent cursor
    expect(pickProxyPoolId(pools, "round-robin", "provA")).toBe("b");
    expect(pickProxyPoolId(pools, "round-robin", "provB")).toBe("b");
  });

  it("round-robin resets cursor when pool composition changes", () => {
    const pools1 = ["a", "b"];
    expect(pickProxyPoolId(pools1, "round-robin", "provX")).toBe("a");
    expect(pickProxyPoolId(pools1, "round-robin", "provX")).toBe("b");
    // pool removed → hash changes → cursor resets to first
    expect(pickProxyPoolId(["a"], "round-robin", "provX")).toBe("a");
    expect(pickProxyPoolId(["a"], "round-robin", "provX")).toBe("a");
  });

  it("random picks within pool bounds", () => {
    const pools = ["a", "b", "c", "d"];
    for (let i = 0; i < 50; i++) {
      const pick = pickProxyPoolId(pools, "random", "provY");
      expect(pools).toContain(pick);
    }
  });

  it("unknown strategy falls back to first pool", () => {
    expect(pickProxyPoolId(["a", "b"], "weird", "provZ")).toBe("a");
  });
});
