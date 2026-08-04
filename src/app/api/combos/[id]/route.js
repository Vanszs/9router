import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";
import { invalidateAllowedModelsCache } from "@/sse/services/allowedModels.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// Validate advertised context length: positive integer, null/unlimited allowed,
// upper bound 2M tokens (no combo member exceeds it in practice; values above
// the largest member capacity are allowed but the UI shows a warning badge —
// the value is only an advertisement via /v1/models, real capacity depends on
// the underlying models).
const MAX_CONTEXT_LENGTH = 2_000_000;

export function validateContextLength(value) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { ok: false, error: "context_length must be a positive integer" };
  }
  if (n > MAX_CONTEXT_LENGTH) {
    return { ok: false, error: `context_length must not exceed ${MAX_CONTEXT_LENGTH}` };
  }
  return { ok: true, value: n };
}

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }

      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    // Validate context_length if provided (positive int, within bound)
    if ("context_length" in body) {
      const v = validateContextLength(body.context_length);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      body.context_length = v.value;
    }

    // Capture previous name to invalidate rotation state on rename
    const prev = await getComboById(id);
    const combo = await updateCombo(id, body);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state and models list cache (models/strategy/name/context_length may have changed)
    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);
    invalidateAllowedModelsCache();

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const [prev, success] = await Promise.all([
      getComboById(id),
      deleteCombo(id),
    ]);
    
    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);
    invalidateAllowedModelsCache();
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
