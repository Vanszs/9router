// Migration 005: add optional per-key usage/expiration limits.
// All columns are nullable; null means unlimited / no restriction.
export default {
  version: 5,
  name: "add-api-key-limits",
  up(db) {
    const rows = db.all("PRAGMA table_info(apiKeys)");
    const columns = Array.isArray(rows) ? rows.map((row) => row.name) : [];
    const add = (col, type) => {
      if (!columns.includes(col)) {
        db.exec(`ALTER TABLE apiKeys ADD COLUMN ${col} ${type}`);
      }
    };
    add("expiresAt", "TEXT");
    add("maxTokens", "INTEGER");
    add("maxTokensDaily", "INTEGER");
    add("rpm", "INTEGER");
    add("rph", "INTEGER");        // requests per hour
    add("rpd", "INTEGER");        // requests per day
    add("tokens5h", "INTEGER");   // max tokens in rolling 5-hour window
    add("tokensWeekly", "INTEGER");
    add("tokensMonthly", "INTEGER");
  },
};
