import { NextResponse } from "next/server";
import { listPasskeys, removePasskey } from "@/lib/auth/passkeys.js";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession.js";
import { isLocalRequest } from "@/dashboardGuard.js";
import { getSettings } from "@/lib/localDb.js";

async function checkAuth(request) {
  if (isLocalRequest(request)) {
    const settings = await getSettings();
    return settings.requireLogin !== false ? null : true;
  }
  const token = request.cookies.get("auth_token")?.value;
  return verifyDashboardAuthToken(token);
}

export async function GET(request) {
  try {
    const authed = await checkAuth(request);
    if (!authed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const passkeys = await listPasskeys();
    // Don't expose public key bytes to the client
    const safe = passkeys.map((pk) => ({
      id: pk.id,
      nickname: pk.nickname,
      deviceType: pk.deviceType,
      transports: pk.transports,
      createdAt: pk.createdAt,
      lastUsedAt: pk.lastUsedAt,
    }));
    return NextResponse.json({ passkeys: safe });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const authed = await checkAuth(request);
    if (!authed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Missing passkey ID" }, { status: 400 });
    }
    await removePasskey(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
