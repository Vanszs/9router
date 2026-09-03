import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import {
  createProviderConnection,
  getProviderConnections,
  updateProviderConnection,
} from "@/models";
import { KIRO_CONFIG } from "@/lib/oauth/constants/oauth";
import { findKiroConnectionByIdentity } from "@/lib/oauth/kiroConnectionIdentity";
import { classifyKiroSocialPoll } from "@/lib/oauth/kiroSocialPoll";

/**
 * POST /api/oauth/kiro/social-exchange
 * Poll device code for tokens (Google/GitHub social login device flow).
 * Frontend calls this repeatedly until authorization completes.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON body",
      },
      { status: 400 }
    );
  }

  const { deviceCode, provider, targetProvider } = body || {};

  if (!deviceCode || !provider || !["google", "github"].includes(provider)) {
    return NextResponse.json(
      { error: "Missing or invalid deviceCode or provider" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(KIRO_CONFIG.socialDevicePollUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode, clientId: KIRO_CONFIG.socialClientId }),
    });

    const data = await response.json();
    const poll = classifyKiroSocialPoll(response.ok, response.status, data);

    if (poll.kind === "pending") {
      return NextResponse.json({
        success: false,
        pending: true,
        error: poll.error,
      });
    }

    if (poll.kind === "error") {
      return NextResponse.json(
        {
          success: false,
          pending: false,
          error: poll.error,
        },
        { status: poll.status }
      );
    }

    const kiroService = new KiroService();
    const email = kiroService.extractEmailFromJWT(data.accessToken);

    const providerSpecificData = {
      authMethod: "imported",
      provider: provider.charAt(0).toUpperCase() + provider.slice(1),
    };

    if (data.profileArn) {
      providerSpecificData.profileArn = data.profileArn;
    }

    // Ensure targetProvider is constrained strictly to kiro or kiro-compatible providers
    const resolvedProvider = (targetProvider === "kiro" || targetProvider?.startsWith("kiro-")) ? targetProvider : "kiro";
    const record = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: new Date(Date.now() + (data.expiresIn || 3600) * 1000).toISOString(),
      email: email || null,
      providerSpecificData,
      testStatus: "active",
      isActive: true,
    };

    const existing = await getProviderConnections({ provider: resolvedProvider });
    const match = findKiroConnectionByIdentity(existing, {
      authType: "oauth",
      profileArn: data.profileArn,
      email,
    });

    const connection =
      typeof match?.id === "string" || typeof match?.id === "number"
        ? await updateProviderConnection(match.id, record)
        : await createProviderConnection({
            provider: resolvedProvider,
            authType: "oauth",
            ...record,
          });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.error("Kiro social exchange error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
