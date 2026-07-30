import { NextResponse } from "next/server";
import { finishPasskeyRegistration } from "@/lib/auth/passkeys.js";
import { isLocalRequest } from "@/dashboardGuard.js";

export async function POST(request) {
  try {
    // Same auth gate as register/start
    if (!isLocalRequest(request)) {
      const token = request.cookies.get("auth_token")?.value;
      const { verifyDashboardAuthToken } = await import("@/lib/auth/dashboardSession.js");
      if (!await verifyDashboardAuthToken(token)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await request.json();
    const { credential, nickname } = body;
    if (!credential) {
      return NextResponse.json({ error: "Missing credential" }, { status: 400 });
    }

    // Read the challenge from the cookie set during register/start
    // The browser credential response does NOT include the challenge
    const expectedChallenge = request.cookies.get("passkey_challenge")?.value;
    if (!expectedChallenge) {
      return NextResponse.json({ error: "Challenge expired or missing. Please try registering again." }, { status: 400 });
    }

    // Attach the challenge to the credential object for verification
    credential.challenge = expectedChallenge;

    const result = await finishPasskeyRegistration(request, credential, nickname);

    // Clear the challenge cookie
    const response = NextResponse.json(result);
    response.cookies.delete("passkey_challenge", { path: "/api/auth/passkey/register" });

    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
