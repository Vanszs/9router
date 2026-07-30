export default {
  version: 5,
  name: "add-passkeys-table",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS passkeys (
        id TEXT PRIMARY KEY,
        publicKey TEXT NOT NULL,
        counter INTEGER DEFAULT 0,
        transports TEXT,
        deviceType TEXT,
        nickname TEXT,
        createdAt TEXT NOT NULL,
        lastUsedAt TEXT
      )
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_passkey_created ON passkeys(createdAt)");
  },
};
