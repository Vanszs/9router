import { getAdapter } from "../driver.js";

// Time key generators using UTC for cross-timezone consistency
function getMinuteKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function getHourKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}`;
}

function getDateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function getWeekKey(ts = Date.now()) {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day; // Sunday of this UTC week
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
}

function getMonthKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Check limits and optionally reserve admission in a single atomic transaction.
 * @param {object} apiKeyInfo - key row from apiKeysRepo
 * @param {number} estimatedTokens - rough estimate of prompt tokens (or 0)
 * @param {boolean} reserveRequest - if true, atomics increment request counter at admission
 * @returns {Promise<{ allowed: boolean, reason?: string, retryAfterMs?: number }>}
 */
export async function checkApiKeyLimits(apiKeyInfo, estimatedTokens = 0, reserveRequest = false) {
  if (!apiKeyInfo) return { allowed: true };

  // Expiration check
  if (apiKeyInfo.expiresAt) {
    const expiryTs = new Date(apiKeyInfo.expiresAt).getTime();
    if (!Number.isNaN(expiryTs) && Date.now() >= expiryTs) {
      return { allowed: false, reason: `API key expired on ${apiKeyInfo.expiresAt}` };
    }
  }

  const hasAnyLimit = (
    apiKeyInfo.rpm != null ||
    apiKeyInfo.rph != null ||
    apiKeyInfo.rpd != null ||
    apiKeyInfo.maxTokens != null ||
    apiKeyInfo.maxTokensDaily != null ||
    apiKeyInfo.tokens5h != null ||
    apiKeyInfo.tokensWeekly != null ||
    apiKeyInfo.tokensMonthly != null
  );

  if (!hasAnyLimit) return { allowed: true };

  const db = await getAdapter();
  const keyId = apiKeyInfo.id;
  const now = Date.now();
  const estTokens = Math.max(0, Number(estimatedTokens) || 0);

  // Per-request token cap check
  if (apiKeyInfo.maxTokens != null && estTokens > apiKeyInfo.maxTokens) {
    return { allowed: false, reason: `Estimated token count (${estTokens}) exceeds maximum per-request limit (${apiKeyInfo.maxTokens})` };
  }

  let result = { allowed: true };

  db.transaction(() => {
    // 1. Check RPM
    if (apiKeyInfo.rpm != null) {
      const minKey = getMinuteKey(now);
      const row = db.get(
        `SELECT count FROM apiKeyUsageBuckets WHERE keyId = ? AND bucketType = 'rpm' AND bucketKey = ?`,
        [keyId, minKey]
      );
      const current = row?.count || 0;
      if (current + 1 > apiKeyInfo.rpm) {
        const nextMin = (Math.floor(now / 60000) + 1) * 60000;
        result = {
          allowed: false,
          reason: `Rate limit exceeded: ${apiKeyInfo.rpm} requests per minute`,
          retryAfterMs: Math.max(1000, nextMin - now),
        };
        return;
      }
    }

    // 2. Check RPH
    if (apiKeyInfo.rph != null) {
      const hourKey = getHourKey(now);
      const row = db.get(
        `SELECT count FROM apiKeyUsageBuckets WHERE keyId = ? AND bucketType = 'rph' AND bucketKey = ?`,
        [keyId, hourKey]
      );
      const current = row?.count || 0;
      if (current + 1 > apiKeyInfo.rph) {
        const nextHour = (Math.floor(now / 3600000) + 1) * 3600000;
        result = {
          allowed: false,
          reason: `Rate limit exceeded: ${apiKeyInfo.rph} requests per hour`,
          retryAfterMs: Math.max(1000, nextHour - now),
        };
        return;
      }
    }

    // 3. Check RPD
    if (apiKeyInfo.rpd != null) {
      const dateKey = getDateKey(now);
      const row = db.get(
        `SELECT count FROM apiKeyUsageBuckets WHERE keyId = ? AND bucketType = 'rpd' AND bucketKey = ?`,
        [keyId, dateKey]
      );
      const current = row?.count || 0;
      if (current + 1 > apiKeyInfo.rpd) {
        const nextDay = (Math.floor(now / 86400000) + 1) * 86400000;
        result = {
          allowed: false,
          reason: `Rate limit exceeded: ${apiKeyInfo.rpd} requests per day`,
          retryAfterMs: Math.max(1000, nextDay - now),
        };
        return;
      }
    }

    // 4. Check Daily Tokens
    if (apiKeyInfo.maxTokensDaily != null) {
      const dateKey = getDateKey(now);
      const row = db.get(
        `SELECT tokens FROM apiKeyUsageBuckets WHERE keyId = ? AND bucketType = 'tokensDaily' AND bucketKey = ?`,
        [keyId, dateKey]
      );
      const used = row?.tokens || 0;
      if (used + estTokens > apiKeyInfo.maxTokensDaily) {
        result = { allowed: false, reason: `Daily token limit exceeded: ${apiKeyInfo.maxTokensDaily}` };
        return;
      }
    }

    // 5. Check 5-Hour Tokens
    if (apiKeyInfo.tokens5h != null) {
      const windowStart = now - 5 * 3600000;
      const row = db.get(
        `SELECT SUM(tokens) as totalTokens FROM apiKeyTokenEvents WHERE keyId = ? AND timestamp >= ?`,
        [keyId, windowStart]
      );
      const used = row?.totalTokens || 0;
      if (used + estTokens > apiKeyInfo.tokens5h) {
        result = { allowed: false, reason: `5-hour rolling token window exceeded: ${apiKeyInfo.tokens5h}` };
        return;
      }
    }

    // 6. Check Weekly Tokens
    if (apiKeyInfo.tokensWeekly != null) {
      const weekKey = getWeekKey(now);
      const row = db.get(
        `SELECT tokens FROM apiKeyUsageBuckets WHERE keyId = ? AND bucketType = 'tokensWeekly' AND bucketKey = ?`,
        [keyId, weekKey]
      );
      const used = row?.tokens || 0;
      if (used + estTokens > apiKeyInfo.tokensWeekly) {
        result = { allowed: false, reason: `Weekly token limit exceeded: ${apiKeyInfo.tokensWeekly}` };
        return;
      }
    }

    // 7. Check Monthly Tokens
    if (apiKeyInfo.tokensMonthly != null) {
      const monthKey = getMonthKey(now);
      const row = db.get(
        `SELECT tokens FROM apiKeyUsageBuckets WHERE keyId = ? AND bucketType = 'tokensMonthly' AND bucketKey = ?`,
        [keyId, monthKey]
      );
      const used = row?.tokens || 0;
      if (used + estTokens > apiKeyInfo.tokensMonthly) {
        result = { allowed: false, reason: `Monthly token limit exceeded: ${apiKeyInfo.tokensMonthly}` };
        return;
      }
    }

    // If reserveRequest is true and admission passes, reserve 1 request immediately
    if (reserveRequest) {
      const minKey = getMinuteKey(now);
      const hourKey = getHourKey(now);
      const dateKey = getDateKey(now);

      const bump = (type, key) => {
        db.run(
          `INSERT INTO apiKeyUsageBuckets(keyId, bucketType, bucketKey, count, tokens, updatedAt)
           VALUES (?, ?, ?, 1, 0, ?)
           ON CONFLICT(keyId, bucketType, bucketKey) DO UPDATE SET
             count = count + 1,
             updatedAt = excluded.updatedAt`,
          [keyId, type, key, now]
        );
      };

      bump("rpm", minKey);
      bump("rph", hourKey);
      bump("rpd", dateKey);
    }
  });

  return result;
}

/**
 * Record API key usage atomically into SQLite.
 * Always records request count (unless already reserved) and token consumption.
 * @param {object} apiKeyInfo
 * @param {number} tokensUsed - prompt + completion tokens
 * @param {object} options - { requestAlreadyCounted: boolean }
 */
export async function recordApiKeyUsage(apiKeyInfo, tokensUsed = 0, options = {}) {
  if (!apiKeyInfo) return;
  const db = await getAdapter();
  const keyId = apiKeyInfo.id;
  const now = Date.now();
  const tokens = Math.max(0, Number(tokensUsed) || 0);
  const incReq = options?.requestAlreadyCounted ? 0 : 1;

  const minKey = getMinuteKey(now);
  const hourKey = getHourKey(now);
  const dateKey = getDateKey(now);
  const weekKey = getWeekKey(now);
  const monthKey = getMonthKey(now);

  db.transaction(() => {
    // 1. Request rate buckets
    if (incReq > 0) {
      const bumpReq = (type, key) => {
        db.run(
          `INSERT INTO apiKeyUsageBuckets(keyId, bucketType, bucketKey, count, tokens, updatedAt)
           VALUES (?, ?, ?, 1, 0, ?)
           ON CONFLICT(keyId, bucketType, bucketKey) DO UPDATE SET
             count = count + 1,
             updatedAt = excluded.updatedAt`,
          [keyId, type, key, now]
        );
      };
      bumpReq("rpm", minKey);
      bumpReq("rph", hourKey);
      bumpReq("rpd", dateKey);
    }

    // 2. Token buckets & events
    if (tokens > 0) {
      const bumpTokens = (type, key) => {
        db.run(
          `INSERT INTO apiKeyUsageBuckets(keyId, bucketType, bucketKey, count, tokens, updatedAt)
           VALUES (?, ?, ?, 0, ?, ?)
           ON CONFLICT(keyId, bucketType, bucketKey) DO UPDATE SET
             tokens = tokens + excluded.tokens,
             updatedAt = excluded.updatedAt`,
          [keyId, type, key, tokens, now]
        );
      };

      bumpTokens("tokensDaily", dateKey);
      bumpTokens("tokensWeekly", weekKey);
      bumpTokens("tokensMonthly", monthKey);

      // Insert 5h event
      db.run(
        `INSERT INTO apiKeyTokenEvents(keyId, timestamp, tokens) VALUES(?, ?, ?)`,
        [keyId, now, tokens]
      );

      // Clean up old token events older than 6 hours
      const pruneCutoff = now - 6 * 3600000;
      db.run(`DELETE FROM apiKeyTokenEvents WHERE timestamp < ?`, [pruneCutoff]);
    }
  });
}

/**
 * Get current usage snapshot for an API key (for Dashboard badges & limits display).
 * @param {object} apiKeyInfo
 */
export async function getApiKeyUsageSnapshot(apiKeyInfo) {
  if (!apiKeyInfo) return null;
  const db = await getAdapter();
  const keyId = apiKeyInfo.id;
  const now = Date.now();

  const minKey = getMinuteKey(now);
  const hourKey = getHourKey(now);
  const dateKey = getDateKey(now);
  const weekKey = getWeekKey(now);
  const monthKey = getMonthKey(now);

  const getBucketVal = (type, key, field) => {
    const row = db.get(
      `SELECT ${field} FROM apiKeyUsageBuckets WHERE keyId = ? AND bucketType = ? AND bucketKey = ?`,
      [keyId, type, key]
    );
    return row ? row[field] : 0;
  };

  const window5hStart = now - 5 * 3600000;
  const row5h = db.get(
    `SELECT SUM(tokens) as total FROM apiKeyTokenEvents WHERE keyId = ? AND timestamp >= ?`,
    [keyId, window5hStart]
  );
  const used5h = row5h?.total || 0;

  return {
    rpm: { limit: apiKeyInfo.rpm ?? null, used: getBucketVal("rpm", minKey, "count") },
    rph: { limit: apiKeyInfo.rph ?? null, used: getBucketVal("rph", hourKey, "count") },
    rpd: { limit: apiKeyInfo.rpd ?? null, used: getBucketVal("rpd", dateKey, "count") },
    tokens5h: { limit: apiKeyInfo.tokens5h ?? null, used: used5h },
    maxTokens: { limit: apiKeyInfo.maxTokens ?? null, used: null },
    maxTokensDaily: { limit: apiKeyInfo.maxTokensDaily ?? null, used: getBucketVal("tokensDaily", dateKey, "tokens") },
    tokensWeekly: { limit: apiKeyInfo.tokensWeekly ?? null, used: getBucketVal("tokensWeekly", weekKey, "tokens") },
    tokensMonthly: { limit: apiKeyInfo.tokensMonthly ?? null, used: getBucketVal("tokensMonthly", monthKey, "tokens") },
  };
}
