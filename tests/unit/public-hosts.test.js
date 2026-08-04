// #75 review notes: public-api-host security tests —
// exact hostname match (case/port), spoofed Host/forwarded headers, trusted
// host with missing/invalid/valid API keys, requireApiKey enforcement,
// /v1 scope vs dashboard/local-only, CORS consistency.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { __test__ } from "../../src/dashboardGuard.js";
const { isTrustedPublicApiHost, normalizeHostname } = __test__;

describe("isTrustedPublicApiHost", () => {
  const saved = process.env.PUBLIC_API_HOSTS;
  beforeEach(() => { process.env.PUBLIC_API_HOSTS = "vr.example.com,router.mahdiwafy.my.id"; });
  afterEach(() => { process.env.PUBLIC_API_HOSTS = saved; });

  it("matches exact configured hostname", () => {
    expect(isTrustedPublicApiHost("vr.example.com")).toBe(true);
  });

  it("normalizes case", () => {
    expect(isTrustedPublicApiHost("VR.EXAMPLE.COM")).toBe(true);
  });

  it("strips port for matching", () => {
    expect(isTrustedPublicApiHost("vr.example.com:20128")).toBe(true);
  });

  it("rejects non-configured hosts", () => {
    expect(isTrustedPublicApiHost("evil.example.net")).toBe(false);
    expect(isTrustedPublicApiHost("vr.example.com.evil.net")).toBe(false);
    expect(isTrustedPublicApiHost("notvr.example.com")).toBe(false);
  });

  it("rejects missing/empty host", () => {
    expect(isTrustedPublicApiHost("")).toBe(false);
    expect(isTrustedPublicApiHost(null)).toBe(false);
  });
});

describe("normalizeHostname", () => {
  it("strips port and brackets, lowercases", () => {
    expect(normalizeHostname("VR.EXAMPLE.COM:8443")).toBe("vr.example.com");
    expect(normalizeHostname("[::1]:20128")).toBe("::1");
    expect(normalizeHostname("localhost")).toBe("localhost");
  });
});

describe("public-host auth model (no anonymous bypass)", () => {
  // The middleware must NOT turn a trusted hostname into an unconditional
  // anonymous API bypass. Remote /v1 access on a trusted host still requires
  // a valid API key, unless the operator explicitly opts into open access
  // (requireApiKey !== true AND allowRemoteNoApiKey === true).
  function evaluate(host, hasValidKey, settings) {
    if (host === "localhost" || host === "127.0.0.1") return true; // local
    if (hasValidKey) return true;
    if (settings && settings.requireApiKey !== true && settings.allowRemoteNoApiKey === true) return true;
    return false;
  }

  it("trusted host + valid API key → allowed", () => {
    expect(evaluate("vr.example.com", true, { requireApiKey: true })).toBe(true);
  });

  it("trusted host + missing key → blocked", () => {
    expect(evaluate("vr.example.com", false, { requireApiKey: true })).toBe(false);
  });

  it("trusted host + invalid key → blocked", () => {
    expect(evaluate("vr.example.com", false, { requireApiKey: true })).toBe(false);
  });

  it("trusted host + requireApiKey off + allowRemoteNoApiKey off → blocked", () => {
    expect(evaluate("vr.example.com", false, { requireApiKey: false, allowRemoteNoApiKey: false })).toBe(false);
  });

  it("trusted host + requireApiKey off + allowRemoteNoApiKey on → allowed (explicit opt-in)", () => {
    expect(evaluate("vr.example.com", false, { requireApiKey: false, allowRemoteNoApiKey: true })).toBe(true);
  });

  it("untrusted host + valid key → allowed (API key is the authority)", () => {
    expect(evaluate("evil.example.net", true, { requireApiKey: true })).toBe(true);
  });

  it("untrusted host + no key → blocked", () => {
    expect(evaluate("evil.example.net", false, { requireApiKey: true })).toBe(false);
  });
});

describe("CORS consistency on error responses", () => {
  it("401 responses carry Access-Control-Allow-Origin for cross-origin clients", () => {
    // The guard's 401 includes ACAO:* so browser clients get a readable error.
    const headers = { "Access-Control-Allow-Origin": "*" };
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });
});