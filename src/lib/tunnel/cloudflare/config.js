// Cloudflare quick tunnel: DNS propagates fast, short timeouts OK
export const HEALTH_CHECK = {
  intervalMs: 2000,
  timeoutMs: 60000,
  fetchTimeoutMs: 5000,
  dnsTimeoutMs: 2000,
};

export const WORKER_URL = process.env.TUNNEL_WORKER_URL || "https://abc-tunnel.us";

// ─── Named tunnel (custom domain) config ────────────────────────────────
// When configured, enableTunnel() runs a NAMED tunnel instead of the
// anonymous quick tunnel, exposing the router on the operator's own
// hostname (e.g. vr.example.com). DNS for that hostname must be a CNAME to
// the tunnel's <tunnel-id>.cfargotunnel.com (proxied) — see README.
//
// Two auth modes are supported (pick one):
//   A. Token:    TUNNEL_TOKEN=<token from `cloudflared tunnel token <id>`>
//   B. Creds:    TUNNEL_CRED_FILE=<path to tunnel credentials .json inside the container>
//                TUNNEL_ID=<tunnel UUID> (optional — auto-read from credentials file)
// TUNNEL_HOSTNAME is required in both modes.
export const NAMED_TUNNEL_TOKEN = process.env.TUNNEL_TOKEN || "";
export const NAMED_TUNNEL_HOSTNAME = (process.env.TUNNEL_HOSTNAME || "").trim().toLowerCase();
export const NAMED_TUNNEL_CRED_FILE = process.env.TUNNEL_CRED_FILE || "";
export const NAMED_TUNNEL_ID = process.env.TUNNEL_ID || "";

// Valid hostname: labels of alphanumerics + hyphens, no leading/trailing hyphen,
// dot-separated, max 253 chars, no scheme/path/port.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isNamedTunnelConfigured() {
  return !!(NAMED_TUNNEL_HOSTNAME && (NAMED_TUNNEL_TOKEN || NAMED_TUNNEL_CRED_FILE));
}

/**
 * Validate the named-tunnel environment configuration.
 * Returns { ok: true } or { ok: false, errors: string[] }.
 *
 * Rules (per VansRouter review):
 * - TUNNEL_HOSTNAME must be a bare hostname (no scheme, path, port).
 * - Exactly one auth mode: either TUNNEL_TOKEN or TUNNEL_CRED_FILE, not both.
 * - TUNNEL_CRED_FILE mode may optionally use TUNNEL_ID.
 */
export function validateNamedTunnelConfig({ hostname = NAMED_TUNNEL_HOSTNAME, token = NAMED_TUNNEL_TOKEN, credFile = NAMED_TUNNEL_CRED_FILE, id = NAMED_TUNNEL_ID } = {}) {
  const errors = [];

  if (!hostname) {
    errors.push("TUNNEL_HOSTNAME is required for a named tunnel");
  } else if (!HOSTNAME_RE.test(hostname)) {
    errors.push(`TUNNEL_HOSTNAME must be a bare DNS hostname (got "${hostname}")`);
  }

  const hasToken = !!token;
  const hasCred = !!credFile;
  if (!hasToken && !hasCred) {
    errors.push("TUNNEL_TOKEN or TUNNEL_CRED_FILE is required (exactly one auth mode)");
  } else if (hasToken && hasCred) {
    errors.push("TUNNEL_TOKEN and TUNNEL_CRED_FILE are mutually exclusive — pick one auth mode");
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
