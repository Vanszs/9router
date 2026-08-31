// Migration 005: add optional per-key usage/expiration limits & allowedModels.
// All limit columns are nullable; null means unlimited / no restriction.
export default {
  version: 5,
  name: "add-api-key-limits-and-models",
  up(db) {
    const rows = db.all("PRAGMA table_info(apiKeys)");
    const columns = Array.isArray(rows) ? rows.map((row) => row.name) : [];
    const add = (col, type) => {
      if (!columns.includes(col)) {
        db.exec(`ALTER TABLE apiKeys ADD COLUMN ${col} ${type}`);
      }
    };
    add("allowedModels", "TEXT");  // JSON array of allowed model names/patterns
    add("expiresAt", "TEXT");
    add("maxTokens", "INTEGER");
    add("maxTokensDaily", "INTEGER");
    add("rpm", "INTEGER");        // requests per minute
    add("rph", "INTEGER");        // requests per hour
    add("rpd", "INTEGER");        // requests per day
    add("tokens5h", "INTEGER");   // max tokens in rolling 5-hour window
    add("tokensWeekly", "INTEGER");
    add("tokensMonthly", "INTEGER");

    // Create persistent usage tracking table for API keys
    db.exec(`
      CREATE TABLE IF NOT EXISTS apiKeyUsageBuckets (
        keyId TEXT NOT NULL,
        bucketType TEXT NOT NULL,
        bucketKey TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (keyId, bucketType, bucketKey)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_akub_key_type ON apiKeyUsageBuckets(keyId, bucketType)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_akub_updated ON apiKeyUsageBuckets(updatedAt)`);

    // Create table for fine-grained 5h rolling token windows
    db.exec(`
      CREATE TABLE IF NOT EXISTS apiKeyTokenEvents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyId TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens INTEGER NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_akte_key_ts ON apiKeyTokenEvents(keyId, timestamp)`);
  },
};
