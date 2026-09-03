import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";

// Parse a JSON TEXT column with null=all / []=none semantics.
// DB NULL → null (all allowed). DB "[]" → [] (none). DB "[x]" → [x].
function parsePermList(raw) {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Serialize back: null → null (DB NULL), [] → "[]", [x] → "[x]"
function serializePermList(val) {
  if (val === null || val === undefined) return null;
  return JSON.stringify(Array.isArray(val) ? val : []);
}

function parseLimitInt(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

function parseExpiresAt(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val !== "string") return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    allowedProviders: parsePermList(row.allowedProviders),
    allowedCombos: parsePermList(row.allowedCombos),
    allowedKinds: parsePermList(row.allowedKinds),
    allowedModels: parsePermList(row.allowedModels),
    expiresAt: row.expiresAt || null,
    maxTokens: parseLimitInt(row.maxTokens),
    maxTokensDaily: parseLimitInt(row.maxTokensDaily),
    rpm: parseLimitInt(row.rpm),
    rph: parseLimitInt(row.rph),
    rpd: parseLimitInt(row.rpd),
    tokens5h: parseLimitInt(row.tokens5h),
    tokensWeekly: parseLimitInt(row.tokensWeekly),
    tokensMonthly: parseLimitInt(row.tokensMonthly),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, limits = {}) {
  if (!machineId) throw new Error("machineId is required");
  const [db, { generateApiKeyWithMachine }] = await Promise.all([
    getAdapter(),
    import("@/shared/utils/apiKey"),
  ]);
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: randomUUID(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    allowedProviders: limits.allowedProviders !== undefined ? limits.allowedProviders : null,
    allowedCombos: limits.allowedCombos !== undefined ? limits.allowedCombos : null,
    allowedKinds: limits.allowedKinds !== undefined ? limits.allowedKinds : null,
    allowedModels: limits.allowedModels !== undefined ? limits.allowedModels : null,
    expiresAt: parseExpiresAt(limits.expiresAt),
    maxTokens: parseLimitInt(limits.maxTokens),
    maxTokensDaily: parseLimitInt(limits.maxTokensDaily),
    rpm: parseLimitInt(limits.rpm),
    rph: parseLimitInt(limits.rph),
    rpd: parseLimitInt(limits.rpd),
    tokens5h: parseLimitInt(limits.tokens5h),
    tokensWeekly: parseLimitInt(limits.tokensWeekly),
    tokensMonthly: parseLimitInt(limits.tokensMonthly),
  };
  db.run(
    `INSERT INTO apiKeys(
       id, key, name, machineId, isActive, createdAt,
       allowedProviders, allowedCombos, allowedKinds, allowedModels,
       expiresAt, maxTokens, maxTokensDaily, rpm, rph, rpd, tokens5h, tokensWeekly, tokensMonthly
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.createdAt,
      serializePermList(apiKey.allowedProviders),
      serializePermList(apiKey.allowedCombos),
      serializePermList(apiKey.allowedKinds),
      serializePermList(apiKey.allowedModels),
      apiKey.expiresAt,
      apiKey.maxTokens,
      apiKey.maxTokensDaily,
      apiKey.rpm,
      apiKey.rph,
      apiKey.rpd,
      apiKey.tokens5h,
      apiKey.tokensWeekly,
      apiKey.tokensMonthly,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const merged = { ...current };
    if (data.isActive !== undefined) merged.isActive = data.isActive;
    if (data.name !== undefined) merged.name = data.name;
    if ("allowedProviders" in data) merged.allowedProviders = data.allowedProviders;
    if ("allowedCombos" in data) merged.allowedCombos = data.allowedCombos;
    if ("allowedKinds" in data) merged.allowedKinds = data.allowedKinds;
    if ("allowedModels" in data) merged.allowedModels = data.allowedModels;
    if ("expiresAt" in data) merged.expiresAt = parseExpiresAt(data.expiresAt);
    if ("maxTokens" in data) merged.maxTokens = parseLimitInt(data.maxTokens);
    if ("maxTokensDaily" in data) merged.maxTokensDaily = parseLimitInt(data.maxTokensDaily);
    if ("rpm" in data) merged.rpm = parseLimitInt(data.rpm);
    if ("rph" in data) merged.rph = parseLimitInt(data.rph);
    if ("rpd" in data) merged.rpd = parseLimitInt(data.rpd);
    if ("tokens5h" in data) merged.tokens5h = parseLimitInt(data.tokens5h);
    if ("tokensWeekly" in data) merged.tokensWeekly = parseLimitInt(data.tokensWeekly);
    if ("tokensMonthly" in data) merged.tokensMonthly = parseLimitInt(data.tokensMonthly);

    db.run(
      `UPDATE apiKeys SET
         key = ?, name = ?, machineId = ?, isActive = ?,
         allowedProviders = ?, allowedCombos = ?, allowedKinds = ?, allowedModels = ?,
         expiresAt = ?, maxTokens = ?, maxTokensDaily = ?, rpm = ?, rph = ?, rpd = ?,
         tokens5h = ?, tokensWeekly = ?, tokensMonthly = ?
       WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        serializePermList(merged.allowedProviders),
        serializePermList(merged.allowedCombos),
        serializePermList(merged.allowedKinds),
        serializePermList(merged.allowedModels),
        merged.expiresAt,
        merged.maxTokens,
        merged.maxTokensDaily,
        merged.rpm,
        merged.rph,
        merged.rpd,
        merged.tokens5h,
        merged.tokensWeekly,
        merged.tokensMonthly,
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  let deleted = false;
  db.transaction(() => {
    const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
    db.run(`DELETE FROM apiKeyUsageBuckets WHERE keyId = ?`, [id]);
    db.run(`DELETE FROM apiKeyTokenEvents WHERE keyId = ?`, [id]);
    deleted = (res?.changes ?? 0) > 0;
  });
  return deleted;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (!row || (row.isActive !== 1 && row.isActive !== true)) return null;
  const keyInfo = rowToKey(row);
  if (keyInfo.expiresAt) {
    const expiryTs = new Date(keyInfo.expiresAt).getTime();
    if (!Number.isNaN(expiryTs) && Date.now() >= expiryTs) {
      return null;
    }
  }
  return keyInfo;
}
