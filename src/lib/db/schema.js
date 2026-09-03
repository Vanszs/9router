// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION = 9;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  proxyPoolFitness: {
    columns: {
      poolId: "TEXT NOT NULL",
      scope: "TEXT NOT NULL",
      until: "INTEGER NOT NULL",
      reason: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (poolId, scope)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ppf_pool ON proxyPoolFitness(poolId)",
      "CREATE INDEX IF NOT EXISTS idx_ppf_scope ON proxyPoolFitness(scope)",
      "CREATE INDEX IF NOT EXISTS idx_ppf_until ON proxyPoolFitness(until)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      allowedProviders: "TEXT",
      allowedCombos: "TEXT",
      allowedKinds: "TEXT",
      allowedModels: "TEXT",
      expiresAt: "TEXT",
      maxTokens: "INTEGER",
      maxTokensDaily: "INTEGER",
      rpm: "INTEGER",
      rph: "INTEGER",
      rpd: "INTEGER",
      tokens5h: "INTEGER",
      tokensWeekly: "INTEGER",
      tokensMonthly: "INTEGER",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
  },
  apiKeyUsageBuckets: {
    columns: {
      keyId: "TEXT NOT NULL",
      bucketType: "TEXT NOT NULL",
      bucketKey: "TEXT NOT NULL",
      count: "INTEGER NOT NULL DEFAULT 0",
      tokens: "INTEGER NOT NULL DEFAULT 0",
      updatedAt: "INTEGER NOT NULL",
    },
    primaryKey: "PRIMARY KEY (keyId, bucketType, bucketKey)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_akub_key_type ON apiKeyUsageBuckets(keyId, bucketType)",
      "CREATE INDEX IF NOT EXISTS idx_akub_updated ON apiKeyUsageBuckets(updatedAt)",
    ],
  },
  apiKeyTokenEvents: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      keyId: "TEXT NOT NULL",
      timestamp: "INTEGER NOT NULL",
      tokens: "INTEGER NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_akte_key_ts ON apiKeyTokenEvents(keyId, timestamp)",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      context_length: "INTEGER",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      apiKeyName: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      apiKeyName: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  cachedProviderModels: {
    columns: {
      providerId: "TEXT NOT NULL",
      modelId: "TEXT NOT NULL",
      kind: "TEXT DEFAULT 'llm'",
      ownedBy: "TEXT NOT NULL",
      capabilities: "TEXT",
      updatedAt: "INTEGER NOT NULL",
    },
    primaryKey: "PRIMARY KEY (providerId, modelId)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cpm_kind ON cachedProviderModels(kind)",
      "CREATE INDEX IF NOT EXISTS idx_cpm_provider ON cachedProviderModels(providerId)",
    ],
  },
};


export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
