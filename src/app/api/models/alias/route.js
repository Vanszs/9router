import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, deleteModelAlias } from "@/models";
import { invalidateAllowedModelsCache } from "@/sse/services/allowedModels.js";

export const dynamic = "force-dynamic";

// GET /api/models/alias - Get all aliases
export async function GET() {
  try {
    const aliases = await getModelAliases();
    return NextResponse.json({ aliases });
  } catch (error) {
    console.error("Error fetching aliases:", error);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// PUT /api/models/alias - Set model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const cleanAlias = String(alias).trim();
    if (!cleanAlias) {
      return NextResponse.json({ error: "Alias required" }, { status: 400 });
    }
    if (cleanAlias.includes("/") || /\s/.test(cleanAlias)) {
      return NextResponse.json({ error: "Alias cannot contain spaces or '/'" }, { status: 400 });
    }

    const existing = await getModelAliases();
    const takenBy = Object.entries(existing).find(
      ([key, val]) => key === cleanAlias && val !== model
    );
    if (takenBy) {
      return NextResponse.json(
        { error: `Alias "${cleanAlias}" already exists for ${takenBy[1]}` },
        { status: 409 }
      );
    }

    await setModelAlias(cleanAlias, model);
    invalidateAllowedModelsCache();

    return NextResponse.json({ success: true, model, alias: cleanAlias });
  } catch (error) {
    console.error("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}

// DELETE /api/models/alias?alias=xxx - Delete alias
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return NextResponse.json({ error: "Alias required" }, { status: 400 });
    }

    await deleteModelAlias(alias);
    invalidateAllowedModelsCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting alias:", error);
    return NextResponse.json({ error: "Failed to delete alias" }, { status: 500 });
  }
}
