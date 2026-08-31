import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey, getApiKeyUsageSnapshot } from "@/lib/localDb";

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

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    const usage = await getApiKeyUsageSnapshot(key);
    return NextResponse.json({ key: { ...key, usage } });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const validationErrors = validateLimitsInput(body);
    if (validationErrors.length > 0) {
      return NextResponse.json({ error: validationErrors.join("; ") }, { status: 400 });
    }

    const updateData = {};
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if ("name" in body && typeof body.name === "string" && body.name.trim()) {
      updateData.name = body.name.trim();
    }
    if ("allowedProviders" in body) updateData.allowedProviders = body.allowedProviders;
    if ("allowedCombos" in body) updateData.allowedCombos = body.allowedCombos;
    if ("allowedKinds" in body) updateData.allowedKinds = body.allowedKinds;
    if ("allowedModels" in body) updateData.allowedModels = body.allowedModels;
    if ("expiresAt" in body) updateData.expiresAt = body.expiresAt;
    if ("maxTokens" in body) updateData.maxTokens = body.maxTokens;
    if ("maxTokensDaily" in body) updateData.maxTokensDaily = body.maxTokensDaily;
    if ("rpm" in body) updateData.rpm = body.rpm;
    if ("rph" in body) updateData.rph = body.rph;
    if ("rpd" in body) updateData.rpd = body.rpd;
    if ("tokens5h" in body) updateData.tokens5h = body.tokens5h;
    if ("tokensWeekly" in body) updateData.tokensWeekly = body.tokensWeekly;
    if ("tokensMonthly" in body) updateData.tokensMonthly = body.tokensMonthly;

    const updated = await updateApiKey(id, updateData);
    const usage = await getApiKeyUsageSnapshot(updated);
    return NextResponse.json({ key: { ...updated, usage } });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
