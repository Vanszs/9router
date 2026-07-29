import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName, getComboByAlias } from "@/lib/localDb";
import { invalidateAllowedModelsCache } from "@/sse/services/allowedModels.js";
import { COMBO_NAME_REGEX, COMBO_NAME_HINT, COMBO_ALIAS_HINT } from "@/shared/constants/comboValidation.js";

export const dynamic = "force-dynamic";

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.error("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, kind, alias, context_length } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!COMBO_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: COMBO_NAME_HINT }, { status: 400 });
    }

    // Validate alias format if provided
    const cleanAlias = alias?.trim() || null;
    if (cleanAlias && !COMBO_NAME_REGEX.test(cleanAlias)) {
      return NextResponse.json({ error: COMBO_ALIAS_HINT }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    // Check if alias already taken
    if (cleanAlias) {
      const aliasOwner = await getComboByAlias(cleanAlias);
      if (aliasOwner) {
        return NextResponse.json({ error: `Alias "${cleanAlias}" already used by combo "${aliasOwner.name}"` }, { status: 409 });
      }
    }

    const combo = await createCombo({
      name,
      alias: cleanAlias,
      models: models || [],
      kind: kind || null,
      context_length: context_length ? Number(context_length) : null,
    });
    invalidateAllowedModelsCache();

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.error("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
