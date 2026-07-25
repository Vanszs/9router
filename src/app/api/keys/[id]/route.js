import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
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
    const { isActive, allowedProviders, allowedCombos, allowedKinds, allowedModels } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    // null = all allowed, [] = none, [x] = specific. Only update if key present in body.
    if ("allowedProviders" in body) {
      updateData.allowedProviders = allowedProviders === null ? null : (Array.isArray(allowedProviders) ? allowedProviders : null);
    }
    if ("allowedCombos" in body) {
      updateData.allowedCombos = allowedCombos === null ? null : (Array.isArray(allowedCombos) ? allowedCombos : null);
    }
    if ("allowedKinds" in body) {
      updateData.allowedKinds = allowedKinds === null ? null : (Array.isArray(allowedKinds) ? allowedKinds : null);
    }
    if ("allowedModels" in body) {
      updateData.allowedModels = allowedModels === null ? null : (Array.isArray(allowedModels) ? allowedModels : null);
    }

    const updated = await updateApiKey(id, updateData);
    return NextResponse.json({ key: updated });
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
