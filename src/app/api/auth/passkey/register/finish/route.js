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

    const result = await finishPasskeyRegistration(request, credential, nickname);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
