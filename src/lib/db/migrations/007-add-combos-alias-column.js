// Migration 006: add alias column to combos (nullable TEXT). Stores an optional
// short alias mapped to this combo so users can call it via `alias/combo-name`
// or as a single token. null = no alias.
export default {
  version: 7,
  name: "add-combos-alias-column",
  up(db) {
    const columns = db
      .all(`PRAGMA table_info(combos)`)
      .map((c) => c.name);
    if (!columns.includes("alias")) {
      db.exec("ALTER TABLE combos ADD COLUMN alias TEXT");
    }
  },
};
