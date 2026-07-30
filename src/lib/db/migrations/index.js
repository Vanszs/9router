import m001 from "./001-initial.js";
import m002 from "./002-fix-empty-allowed-lists.js";
import m003 from "./003-add-allowed-lists-columns.js";
import m004 from "./004-add-request-details-apikey.js";
import m005 from "./005-add-allowed-models-column.js";
import m006 from "./006-add-api-key-limits.js";
import m007 from "./007-add-combos-alias-column.js";
import m008 from "./008-add-passkeys.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}

export async function runMigrations() {
  const { getAdapter } = await import("../driver.js");
  const db = await getAdapter();
  // Ensure meta table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT,
      appliedAt TEXT
    )
  `);
  const applied = new Set(
    db.all(`SELECT version FROM _migrations`).map((r) => r.version)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    console.log(`[DB] running migration ${m.name} (v${m.version})`);
    m.up(db);
    db.run(`INSERT INTO _migrations(version, name, appliedAt) VALUES(?, ?, ?)`, [
      m.version,
      m.name,
      new Date().toISOString(),
    ]);
  }
}
