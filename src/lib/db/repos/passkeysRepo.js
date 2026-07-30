import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export async function getPasskeys() {
  const db = await getAdapter();
  const rows = db.all("SELECT * FROM passkeys ORDER BY createdAt DESC");
  return rows.map((row) => ({
    id: row.id,
    publicKey: row.publicKey,
    counter: row.counter || 0,
    transports: parseJson(row.transports, []),
    deviceType: row.deviceType || null,
    nickname: row.nickname || null,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
  }));
}

export async function getPasskeyById(id) {
  const db = await getAdapter();
  const row = db.get("SELECT * FROM passkeys WHERE id = ?", [id]);
  if (!row) return null;
  return {
    id: row.id,
    publicKey: row.publicKey,
    counter: row.counter || 0,
    transports: parseJson(row.transports, []),
    deviceType: row.deviceType || null,
    nickname: row.nickname || null,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
  };
}

export async function createPasskey(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO passkeys (id, publicKey, counter, transports, deviceType, nickname, createdAt, lastUsedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       publicKey = excluded.publicKey,
       counter = excluded.counter,
       transports = excluded.transports,
       deviceType = excluded.deviceType,
       nickname = excluded.nickname`,
    [
      data.id,
      data.publicKey,
      data.counter || 0,
      stringifyJson(data.transports || []),
      data.deviceType || null,
      data.nickname || null,
      now,
      null,
    ]
  );
  return getPasskeyById(data.id);
}

export async function updatePasskeyCounter(id, counter, lastUsedAt) {
  const db = await getAdapter();
  db.run(
    "UPDATE passkeys SET counter = ?, lastUsedAt = ? WHERE id = ?",
    [counter, lastUsedAt || new Date().toISOString(), id]
  );
}

export async function deletePasskey(id) {
  const db = await getAdapter();
  db.run("DELETE FROM passkeys WHERE id = ?", [id]);
}

export async function getPasskeyCount() {
  const db = await getAdapter();
  const row = db.get("SELECT COUNT(*) as count FROM passkeys");
  return row?.count || 0;
}
