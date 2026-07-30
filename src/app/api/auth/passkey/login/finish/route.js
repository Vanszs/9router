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

    const result = await finishPasskeyLogin(request, assertion);
    if (result.verified) {
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request, { passkey: true });
      return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
