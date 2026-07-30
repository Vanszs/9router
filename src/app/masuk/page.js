import { cookies } from "next/headers";
import { headers } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { isLocalRequest } from "@/dashboardGuard";
import MasukClient from "./MasukClient";

export default async function MasukPage() {
  let initialAuth = { hasPassword: true, authMode: "password", oidcConfigured: false, oidcLoginLabel: "Masuk dengan OIDC", requireLogin: true, isLocal: false, passkeysEnabled: false };
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const headerStore = await headers();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;

    // Build a request-like object for isLocalRequest
    const req = { headers: headerStore };
    const local = isLocalRequest(req);

    initialAuth = {
      requireLogin,
      authMode: settings.authMode || "password",
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      hasPassword: !!settings.password,
      isLoggedIn: !!session,
      isLocal: local,
      passkeysEnabled: !!settings.passkeysEnabled,
    };
  } catch {}
  return <MasukClient initialAuth={initialAuth} />;
}
