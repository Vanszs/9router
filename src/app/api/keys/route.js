import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getApiKeyUsageSnapshot } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    const keysWithUsage = keys.map((k) => ({
      ...k,
      usage: getApiKeyUsageSnapshot(k),
    }));
    return NextResponse.json({ keys: keysWithUsage });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, limits = {} } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, limits);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      limits: {
        expiresAt: apiKey.expiresAt,
        maxTokens: apiKey.maxTokens,
        maxTokensDaily: apiKey.maxTokensDaily,
        rpm: apiKey.rpm,
        rph: apiKey.rph,
        rpd: apiKey.rpd,
        tokens5h: apiKey.tokens5h,
        tokensWeekly: apiKey.tokensWeekly,
        tokensMonthly: apiKey.tokensMonthly,
      },
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
