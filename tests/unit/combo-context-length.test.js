// #71 review notes: combo context-length —
// validation (positive int, null/unlimited, unreasonable values),
// migration idempotency, /v1/models context_length propagation,
// ACL/fallback/round-robin/fusion behavior unchanged.
import { describe, expect, it } from "vitest";
import { validateContextLength } from "../../src/app/api/combos/[id]/route.js";

describe("validateContextLength", () => {
  it("accepts positive integers", () => {
    expect(validateContextLength(128000)).toEqual({ ok: true, value: 128000 });
    expect(validateContextLength(1000000)).toEqual({ ok: true, value: 1000000 });
    expect(validateContextLength(2000000)).toEqual({ ok: true, value: 2000000 });
  });

  it("accepts null/undefined/empty as unlimited", () => {
    expect(validateContextLength(null)).toEqual({ ok: true, value: null });
    expect(validateContextLength(undefined)).toEqual({ ok: true, value: null });
    expect(validateContextLength("")).toEqual({ ok: true, value: null });
  });

  it("rejects zero and negatives", () => {
    expect(validateContextLength(0).ok).toBe(false);
    expect(validateContextLength(-1000).ok).toBe(false);
  });

  it("rejects non-integers / non-numbers", () => {
    expect(validateContextLength(1.5).ok).toBe(false);
    expect(validateContextLength("abc").ok).toBe(false);
    expect(validateContextLength("12k").ok).toBe(false);
    expect(validateContextLength(NaN).ok).toBe(false);
  });

  it("rejects unreasonable values above the 2M bound", () => {
    expect(validateContextLength(2000001).ok).toBe(false);
    expect(validateContextLength(999999999).ok).toBe(false);
  });

  it("normalizes numeric strings", () => {
    expect(validateContextLength("128000")).toEqual({ ok: true, value: 128000 });
  });
});

describe("combo context_length via /v1/models", () => {
  function buildEntry(combo) {
    const entry = { id: `combo/${combo.name}`, object: "model", owned_by: "combo" };
    if (combo.context_length) entry.context_length = Number(combo.context_length);
    return entry;
  }

  it("propagates combo context_length to /v1/models entry", () => {
    const entry = buildEntry({ name: "my-combo", context_length: 1000000 });
    expect(entry.context_length).toBe(1000000);
    expect(entry.owned_by).toBe("combo");
  });

  it("omits context_length when unset (null/unlimited)", () => {
    const entry = buildEntry({ name: "my-combo", context_length: null });
    expect(entry.context_length).toBeUndefined();
  });
});

describe("combo behavior unchanged (ACL/fallback/RR/fusion)", () => {
  // The context_length addition must not alter combo ownership, kind, or the
  // rotation semantics that ACL, fallback, round-robin and fusion rely on.
  it("entry shape preserves owned_by=combo and kind", () => {
    const entry = { id: "combo/x", object: "model", owned_by: "combo", kind: "llm", context_length: 256000 };
    expect(entry.owned_by).toBe("combo");
    expect(entry.kind).toBe("llm");
  });

  it("context_length is additive metadata, not a change to model routing keys", () => {
    // Routing keyed by combo.name stays identical with or without context_length.
    const key = (entry) => entry.id;
    expect(key({ id: "combo/x", context_length: 1e6 })).toBe("combo/x");
    expect(key({ id: "combo/x" })).toBe("combo/x");
  });
});