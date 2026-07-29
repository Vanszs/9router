import { NextResponse } from "next/server";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

// Public API paths — no auth required (LLM API has its own key auth inside handler).
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc",
  "/api/version",
  "/api/settings/require-login",
];

// Public top-level prefixes (LLM API endpoints with their own API key auth).
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex"];

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
];

const PROTECTED_API_PATHS = [
  "/api/settings",
  "/api/keys",
  "/api/providers",
  "/api/provider-nodes",
  "/api/proxy-pools",
  "/api/combos",
  "/api/models",
  "/api/usage",
  "/api/oauth",
  "/api/cloud",
  "/api/media-providers",
  "/api/pricing",
  "/api/tags",
  "/api/cli-tools",
  "/api/mcp",
  "/api/translator",
  "/api/tunnel",
];

// Routes that spawn child processes or read host secrets — restrict to localhost.
const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/cli-tools/antigravity-mitm",
  "/api/mcp/",
  "/api/tunnel/tailscale-install",
  "/api/tunnel/tailscale-enable",
  "/api/tunnel/tailscale-disable",
  "/api/tunnel/tailscale-check",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/auth/reset-password",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/proxy",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Hostnames explicitly trusted for public LLM API access (e.g. Cloudflare tunnel domain).
// Comma-separated list from env; entries may include port.
function getTrustedPublicApiHosts() {
  const raw = process.env.PUBLIC_API_HOSTS || "";
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeHostname(h) {
  if (!h) return "";
  return h.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(h) {
  if (!h) return false;
  const name = normalizeHostname(h);
  return LOOPBACK_HOSTS.has(name);
}

function isTrustedPublicApiHost(h) {
  if (!h) return false;
  const name = normalizeHostname(h);
  return getTrustedPublicApiHosts().has(name);
}

export function isLocalRequest(request) {
  // Stamped by custom-server.js when forwarding headers exist: request came through
  // a reverse proxy, so the loopback socket is the proxy hop, not the end-user.
  if (request.headers.get("x-9r-via-proxy")) return false;
  // Trusted peer IP from TCP socket (custom-server.js); unspoofable. Primary anchor for "local".
  const realIp = request.headers.get("x-9r-real-ip");
  if (realIp) {
    if (!isLoopbackHostname(realIp)) return false;
  } else if (!isLoopbackHostname(request.headers.get("host"))) {
    // Fallback for bare server.js (dev) without custom-server: legacy Host-based check.
    return false;
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  return request.nextUrl.searchParams?.get("key") || null;
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

async function canAccessPublicLlmApi(request) {
  const host = request.headers.get("host") || "";
  const pathname = request.nextUrl.pathname;
  const isTrustedHost = isTrustedPublicApiHost(host);
  const local = isLocalRequest(request);

  if (local || isTrustedHost) {
    if (process.env.DEBUG_AUTH) {
      console.log(`[dashboardGuard] ${pathname} public LLM allowed (local=${local}, trustedHost=${isTrustedHost}, host=${host})`);
    }
    return true;
  }
  if (await hasValidCliToken(request)) {
    console.log(`[dashboardGuard] ${pathname} public LLM allowed via CLI token (host=${host})`);
    return true;
  }
  const apiKey = extractApiKey(request);
  if (apiKey) {
    const valid = await validateApiKey(apiKey);
    if (valid) {
      console.log(`[dashboardGuard] ${pathname} public LLM allowed via API key (host=${host}, keyId=${valid.id?.slice(0, 8)})`);
      return true;
    }
    console.log(`[dashboardGuard] ${pathname} public LLM blocked: API key provided but invalid (host=${host}, masked=${apiKey.slice(0, 8)}...)`);
  }
  // Explicit opt-in: allow anonymous (no API key) remote access ONLY when the
  // operator both disabled API-key enforcement AND turned on open remote access.
  // If requireApiKey is on, the downstream handler would reject a keyless request
  // anyway, so we keep this gated on requireApiKey !== true to avoid a misleading
  // "allowed by middleware, rejected by handler" state.
  const settings = await loadSettings();
  if (settings && settings.requireApiKey !== true && settings.allowRemoteNoApiKey === true) {
    return true;
  }
  console.log(`[dashboardGuard] ${pathname} public LLM blocked: remote API key required (host=${host}, requireApiKey=${settings?.requireApiKey}, allowRemoteNoApiKey=${settings?.allowRemoteNoApiKey})`);
  return false;
}

async function canAccessLocalOnlyRoute(request) {
  if (await hasValidCliToken(request)) return true;
  // Browser on host: loopback Host + Origin (blocks tunnel/CSRF) + auth (JWT or requireLogin=false)
  if (isLocalRequest(request) && await isAuthenticated(request)) return true;
  return false;
}

async function hasValidToken(request) {
  const token = request.cookies.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  const settings = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const __test__ = {
  isLocalRequest,
  isPublicLlmApi,
  extractApiKey,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Local-only gate for spawn-capable / host-secret routes.
  if (LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      const host = request.headers.get("host") || "";
      const ip = request.headers.get("x-9r-real-ip") || "unknown";
      console.log(`[dashboardGuard] ${pathname} blocked: local-only route (host=${host}, ip=${ip})`);
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  // Always protected - require valid JWT or local CLI token (machineId-based)
  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    return NextResponse.json(
      { error: "API key required for remote API access" },
      { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    if (await hasValidCliToken(request) || await isAuthenticated(request))
      return NextResponse.next();
    console.log(`[dashboardGuard] ${pathname} blocked: not authenticated (host=${request.headers.get("host") || ""})`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (pathname === "/masuk" || pathname === "/masuk/") {
    if (await isAuthenticated(request)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // /login - always redirect to /masuk
  if (pathname === "/login" || pathname === "/login/") {
    return NextResponse.redirect(new URL("/masuk", request.url));
  }

  // / - redirect to dashboard if authenticated, otherwise return JSON welcome
  if (pathname === "/") {
    if (await isAuthenticated(request)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    const host = request.headers.get("host") || "api.bevansatria.my.id";
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    const baseUrl = `${protocol}://${host}`;

    return new NextResponse(
      JSON.stringify({
        message: `Welcome to VansAI! Use ${baseUrl}/v1 as your API endpoint.`,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;
    let tunnelDashboardAccess = true;

    try {
      const settings = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        if (!tunnelDashboardAccess) {
          const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
          const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
          if ((tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost)) {
            return NextResponse.redirect(new URL("/masuk", request.url));
          }
        }
      }
    } catch {}

    if (!requireLogin) return NextResponse.next();

    const token = request.cookies.get("auth_token")?.value;
    if (token) {
      if (await verifyDashboardAuthToken(token)) {
        return NextResponse.next();
      } else {
        return NextResponse.redirect(new URL("/masuk", request.url));
      }
    }

    return NextResponse.redirect(new URL("/masuk", request.url));
  }

  return NextResponse.next();
}
