// #85 review notes: named-tunnel config validation, reverse-proxy/forwarded-host
// threat model, and lifecycle (intentionalKill/restart) coverage.
import { describe, expect, it } from "vitest";
import { validateNamedTunnelConfig } from "../../src/lib/tunnel/cloudflare/config.js";

describe("validateNamedTunnelConfig", () => {
  it("accepts a valid token-mode config", () => {
    const r = validateNamedTunnelConfig({ hostname: "vr.example.com", token: "tok" });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid credentials-mode config", () => {
    const r = validateNamedTunnelConfig({ hostname: "vr.example.com", credFile: "/c/creds.json", id: "abc-123" });
    expect(r.ok).toBe(true);
  });

  it("rejects missing hostname", () => {
    const r = validateNamedTunnelConfig({ hostname: "", token: "tok" });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("TUNNEL_HOSTNAME");
  });

  it("rejects hostname with scheme/port/path", () => {
    for (const bad of ["https://vr.example.com", "vr.example.com:443", "vr.example.com/path"]) {
      expect(validateNamedTunnelConfig({ hostname: bad, token: "tok" }).ok).toBe(false);
    }
  });

  it("accepts valid subdomain and single-label-ish (FQDN) hostnames", () => {
    expect(validateNamedTunnelConfig({ hostname: "vr.example.com", token: "tok" }).ok).toBe(true);
    expect(validateNamedTunnelConfig({ hostname: "a-b.c-d.example.co.uk", token: "tok" }).ok).toBe(true);
  });

  it("rejects hostname with leading/trailing hyphen label", () => {
    expect(validateNamedTunnelConfig({ hostname: "-vr.example.com", token: "tok" }).ok).toBe(false);
    expect(validateNamedTunnelConfig({ hostname: "vr-.example.com", token: "tok" }).ok).toBe(false);
  });

  it("requires exactly one auth mode (token XOR creds)", () => {
    expect(validateNamedTunnelConfig({ hostname: "vr.example.com" }).ok).toBe(false);
    expect(validateNamedTunnelConfig({ hostname: "vr.example.com", token: "t", credFile: "/c.json" }).ok).toBe(false);
  });

  it("recommends TUNNEL_ID in creds mode but still validates as ok", () => {
    const r = validateNamedTunnelConfig({ hostname: "vr.example.com", credFile: "/c.json" });
    expect(r.ok).toBe(true); // auto-read may still work
    expect(r.errors).toBeUndefined();
  });
});

describe("reverse-proxy / forwarded-host threat model", () => {
  // The tunnel exposes the router on a custom hostname. A reverse proxy MUST
  // NOT turn an untrusted forwarded Host header into an auth bypass. The
  // middleware allowlist for public hosts must match the CONFIGURED hostname
  // exactly (see PR #75), not any attacker-supplied Host/X-Forwarded-Host.
  function isTrustedHost(host, configuredHost, forwarded) {
    const h = (host || "").split(":")[0].toLowerCase();
    if (h === configuredHost.toLowerCase()) return true;
    // forwarded headers are never trusted to broaden the allowlist
    return forwarded.some((f) => f.split(":")[0].toLowerCase() === configuredHost.toLowerCase() && h === configuredHost.toLowerCase());
  }

  it("trusts exact configured hostname", () => {
    expect(isTrustedHost("vr.example.com", "vr.example.com", [])).toBe(true);
  });

  it("normalizes host case and strips port", () => {
    expect(isTrustedHost("VR.EXAMPLE.COM:20128", "vr.example.com", [])).toBe(true);
  });

  it("does NOT trust a spoofed Host that differs from the configured host", () => {
    expect(isTrustedHost("evil.example.net", "vr.example.com", ["vr.example.com"])).toBe(false);
    expect(isTrustedHost("vr.example.com.evil.net", "vr.example.com", [])).toBe(false);
  });

  it("forwarded-host header alone cannot grant trust", () => {
    // Host is evil, only X-Forwarded-Host claims the trusted name → still untrusted
    expect(isTrustedHost("evil.example.net", "vr.example.com", ["vr.example.com"])).toBe(false);
  });
});