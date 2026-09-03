import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getApiKeyUsageSnapshot } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

function validateLimitsInput(body) {
  const errors = [];
  const intFields = ["maxTokens", "maxTokensDaily", "rpm", "rph", "rpd", "tokens5h", "tokensWeekly", "tokensMonthly"];

  for (const field of intFields) {
    if (field in body && body[field] !== null && body[field] !== undefined && body[field] !== "") {
      const val = Number(body[field]);
      if (!Number.isInteger(val) || val < 0) {
        errors.push(`${field} must be a non-negative integer`);
      }
    }
  }

  if ("expiresAt" in body && body.expiresAt !== null && body.expiresAt !== undefined && body.expiresAt !== "") {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) {
      errors.push("expiresAt must be a valid ISO date/timestamp");
    }
  }

  const listFields = ["allowedProviders", "allowedCombos", "allowedKinds", "allowedModels"];
  for (const field of listFields) {
    if (field in body && body[field] !== null && body[field] !== undefined) {
      if (!Array.isArray(body[field])) {
        errors.push(`${field} must be an array of strings or null`);
      } else if (body[field].some((item) => typeof item !== "string" || !item.trim())) {
        errors.push(`${field} elements must be non-empty strings`);
      }
    }
  }

  return errors;
}

// GET /api/keys - List API keys with optional usage snapshots
export async function GET() {
  try {
    const keys = await getApiKeys();
    const keysWithUsage = await Promise.all(
      keys.map(async (key) => {
        const usage = await getApiKeyUsageSnapshot(key);
        return { ...key, usage };
      })
    );
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
    const { name } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const validationErrors = validateLimitsInput(body);
    if (validationErrors.length > 0) {
      return NextResponse.json({ error: validationErrors.join("; ") }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name.trim(), machineId, body);
    const usage = await getApiKeyUsageSnapshot(apiKey);

    return NextResponse.json({
      ...apiKey,
      usage,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
