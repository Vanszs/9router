import { NextResponse } from "next/server";
import { startPasskeyLogin } from "@/lib/auth/passkeys.js";
import { getSettings } from "@/lib/localDb.js";

export async function POST(request) {
  try {
    const settings = await getSettings();
    // Only allow passkey login if passkeys are enabled and at least one is registered
    if (!settings.passkeysEnabled) {
      return NextResponse.json({ error: "Passkey authentication is not enabled" }, { status: 403 });
    }

    const options = await startPasskeyLogin(request);

    // Store challenge in a cookie so login/finish can verify it
    const response = NextResponse.json(options);
    response.cookies.set("login_challenge", options.challenge, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/passkey/login",
      maxAge: 120, // 2 minutes
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
