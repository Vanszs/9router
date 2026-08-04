import { NextResponse } from "next/server";
import { startPasskeyRegistration } from "@/lib/auth/passkeys.js";
import { isLocalRequest } from "@/dashboardGuard.js";

export async function POST(request) {
  try {
    // Only authenticated dashboard users can register passkeys
    // (local requests bypass auth via requireLogin, remote needs JWT)
    if (!isLocalRequest(request)) {
      const token = request.cookies.get("auth_token")?.value;
      const { verifyDashboardAuthToken } = await import("@/lib/auth/dashboardSession.js");
      if (!await verifyDashboardAuthToken(token)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const options = await startPasskeyRegistration(request);

    // Store challenge in a cookie so register/finish can verify it
    const response = NextResponse.json(options);
    response.cookies.set("passkey_challenge", options.challenge, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/passkey/register",
      maxAge: 120, // 2 minutes
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
