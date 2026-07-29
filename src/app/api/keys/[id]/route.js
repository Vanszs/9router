import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey, getApiKeyUsageSnapshot } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key: { ...key, usage: getApiKeyUsageSnapshot(key) } });
  } catch (error) {
    console.error("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
      const { isActive, name, allowedProviders, allowedCombos, allowedKinds, allowedModels, limits = {} } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (name !== undefined) updateData.name = name;
    // null = all allowed, [] = none, [x] = specific. Only update if key present in body.
    if ("allowedProviders" in body) {
      updateData.allowedProviders = allowedProviders === null ? null : (Array.isArray(allowedProviders) ? allowedProviders : []);
    }
    if ("allowedCombos" in body) {
      updateData.allowedCombos = allowedCombos === null ? null : (Array.isArray(allowedCombos) ? allowedCombos : []);
    }
    if ("allowedKinds" in body) {
      updateData.allowedKinds = allowedKinds === null ? null : (Array.isArray(allowedKinds) ? allowedKinds : []);
    }
    if ("allowedModels" in body) {
      updateData.allowedModels = allowedModels === null ? null : (Array.isArray(allowedModels) ? allowedModels : []);
    }
    if ("expiresAt" in limits || "expiresAt" in body) {
      updateData.expiresAt = limits.expiresAt ?? body.expiresAt ?? null;
    }
    if ("maxTokens" in limits) updateData.maxTokens = limits.maxTokens;
    if ("maxTokensDaily" in limits) updateData.maxTokensDaily = limits.maxTokensDaily;
    if ("rpm" in limits) updateData.rpm = limits.rpm;
    if ("rph" in limits) updateData.rph = limits.rph;
    if ("rpd" in limits) updateData.rpd = limits.rpd;
    if ("tokens5h" in limits) updateData.tokens5h = limits.tokens5h;
    if ("tokensWeekly" in limits) updateData.tokensWeekly = limits.tokensWeekly;
    if ("tokensMonthly" in limits) updateData.tokensMonthly = limits.tokensMonthly;

    const updated = await updateApiKey(id, updateData);
    return NextResponse.json({ key: { ...updated, usage: getApiKeyUsageSnapshot(updated) } });
  } catch (error) {
    console.error("Error updating key:", error);
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
    console.error("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
