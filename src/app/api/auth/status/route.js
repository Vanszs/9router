import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { isLocalRequest } from "@/dashboardGuard";

export async function GET(request) {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const local = isLocalRequest(request);
    const oidcName = String(session?.oidcName || "").trim();
    const oidcEmail = String(session?.oidcEmail || "").trim();
    const isPasskeySession = !!session?.passkey;
    const displayName = oidcName || oidcEmail || (isPasskeySession ? "Passkey user" : (session?.oidc ? "OIDC user" : "Password user"));
    const loginMethod = session?.oidc ? "OIDC" : (isPasskeySession ? "Passkey" : "Password");

    return NextResponse.json({
      requireLogin,
      authMode,
      isLocal: local,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      hasPassword: !!settings.password,
      passkeysEnabled: !!settings.passkeysEnabled,
      remoteAuthMode: settings.remoteAuthMode || "password",
      displayName,
      loginMethod,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      oidcLogin: !!session?.oidc,
      passkeyLogin: isPasskeySession,
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      isLocal: false,
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      hasPassword: false,
      passkeysEnabled: false,
      remoteAuthMode: "password",
      displayName: "Password user",
      loginMethod: "Password",
      oidcName: null,
      oidcEmail: null,
      oidcLogin: false,
      passkeyLogin: false,
    });
  }
}
