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

export function isNamedTunnelConfigured() {
  return !!(NAMED_TUNNEL_HOSTNAME && (NAMED_TUNNEL_TOKEN || NAMED_TUNNEL_CRED_FILE));
}
