// Migration 005: add allowedModels column to apiKeys (null=all, []=none, [id]=specific).
export default {
  version: 5,
  name: "add-allowed-models-column",
  up(db) {
    const columns = db
      .all(`PRAGMA table_info(apiKeys)`)
      .map((c) => c.name);
    if (!columns.includes("allowedModels")) {
      db.exec("ALTER TABLE apiKeys ADD COLUMN allowedModels TEXT");
    }
  },
};
