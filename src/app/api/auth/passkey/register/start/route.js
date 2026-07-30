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
    return NextResponse.json(options);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
