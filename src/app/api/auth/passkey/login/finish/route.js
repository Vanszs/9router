import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { finishPasskeyLogin } from "@/lib/auth/passkeys.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession.js";
import { getSettings } from "@/lib/localDb.js";

export async function POST(request) {
  try {
    const settings = await getSettings();
    if (!settings.passkeysEnabled) {
      return NextResponse.json({ error: "Passkey authentication is not enabled" }, { status: 403 });
    }

    const body = await request.json();
    const { assertion } = body;
    if (!assertion) {
      return NextResponse.json({ error: "Missing assertion" }, { status: 400 });
    }

    // Read the challenge from the cookie set during login/start
    const expectedChallenge = request.cookies.get("login_challenge")?.value;
    if (!expectedChallenge) {
      return NextResponse.json({ error: "Challenge expired or missing. Please try logging in again." }, { status: 400 });
    }

    // Attach the challenge to the assertion for verification
    // The browser assertion response does NOT include the challenge
    assertion.challenge = expectedChallenge;

    const result = await finishPasskeyLogin(request, assertion);
    if (result.verified) {
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request, { passkey: true });

      // Clear the challenge cookie
      const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
      response.cookies.delete("login_challenge", { path: "/api/auth/passkey/login" });
      return response;
    }

    return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
