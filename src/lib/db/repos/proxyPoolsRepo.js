import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, p) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

const PROXY_POOL_CACHE_TTL_MS = 2_000;
const _proxyPoolCache = new Map();

function clearProxyPoolCache() {
  _proxyPoolCache.clear();
}

function getCached(key) {
  const entry = _proxyPoolCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.value;
}

function setCached(key, value) {
  _proxyPoolCache.set(key, { value, expiresAt: Date.now() + PROXY_POOL_CACHE_TTL_MS });
}

export async function getProxyPools(filter = {}) {
  const cacheKey = `list:${JSON.stringify(filter)}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list = db.all(sql, params).map(rowToPool);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  setCached(cacheKey, list);
  return list;
}

export async function getProxyPoolById(id) {
  const cacheKey = `id:${id}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const db = await getAdapter();
  const pool = rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
  setCached(cacheKey, pool);
  return pool;
}

export async function createProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || randomUUID(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  clearProxyPoolCache();
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  clearProxyPoolCache();
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  clearProxyPoolCache();
  return removed;
}
