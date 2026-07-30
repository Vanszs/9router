import { getAdapter } from "../driver.js";

// In-memory rolling counters. We intentionally keep these in process memory
// (not the DB) to avoid write amplification on every request and because
// limit enforcement is best-effort across restarts (a restart resets counters).
// For stricter accounting, callers can persist usage via usageRepo after the fact.

if (!global._apiKeyCounters) {
  global._apiKeyCounters = {
    rpm: new Map(),      // keyId -> { ts: minuteTimestamp, count }
    rph: new Map(),      // keyId -> { ts: hourTimestamp, count }
    rpd: new Map(),      // keyId -> { dateKey, count }
    tokens5h: new Map(), // keyId -> [{ ts, tokens }]
    tokensDaily: new Map(),// keyId -> { dateKey, tokens }
    tokensWeekly: new Map(), // keyId -> { weekKey, tokens }
    tokensMonthly: new Map(),// keyId -> { monthKey, tokens }
  };
}
const counters = global._apiKeyCounters;

function getMinuteTs() {
  return Math.floor(Date.now() / 60000);
}
function getHourTs() {
  return Math.floor(Date.now() / 3600000);
}
function getDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getWeekKey() {
  const d = new Date();
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(d.getDate() - d.getDay()); // Sunday-based week
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}
function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getRollingTokenCount(map, keyId, windowMs) {
  const now = Date.now();
  const entries = map.get(keyId) || [];
  const fresh = entries.filter((e) => now - e.ts <= windowMs);
  if (fresh.length !== entries.length) map.set(keyId, fresh);
  return fresh.reduce((sum, e) => sum + e.tokens, 0);
}

function bumpCounter(map, keyId, bucketKey, amount = 1) {
  let entry = map.get(keyId);
  if (!entry || entry.key !== bucketKey) {
    entry = { key: bucketKey, count: 0 };
    map.set(keyId, entry);
  }
  entry.count += amount;
  return entry.count;
}

function bumpTokens(map, keyId, amount) {
  let entries = map.get(keyId);
  if (!entries) {
    entries = [];
    map.set(keyId, entries);
  }
  entries.push({ ts: Date.now(), tokens: amount });
}

/**
 * Check per-key limits BEFORE processing a request.
 * @param {object} apiKeyInfo - key row from apiKeysRepo
 * @param {number} requestedTokens - estimated tokens for this request (0 if unknown)
 * @returns {{ allowed: boolean, reason?: string, retryAfterMs?: number }}
 */
export function checkApiKeyLimits(apiKeyInfo, requestedTokens = 0) {
  if (!apiKeyInfo) return { allowed: true };
  const keyId = apiKeyInfo.id;
  const tokens = Math.max(0, Number(requestedTokens) || 0);

  // RPM
  const rpmLimit = apiKeyInfo.rpm;
  if (rpmLimit != null) {
    const minute = getMinuteTs();
    const current = bumpCounter(counters.rpm, keyId, minute, 0);
    if (current + 1 > rpmLimit) {
      return { allowed: false, reason: `Rate limit exceeded: ${rpmLimit} requests per minute`, retryAfterMs: (minute + 1) * 60000 - Date.now() };
    }
  }

  // RPH
  const rphLimit = apiKeyInfo.rph;
  if (rphLimit != null) {
    const hour = getHourTs();
    const current = bumpCounter(counters.rph, keyId, hour, 0);
    if (current + 1 > rphLimit) {
      return { allowed: false, reason: `Rate limit exceeded: ${rphLimit} requests per hour`, retryAfterMs: (hour + 1) * 3600000 - Date.now() };
    }
  }

  // RPD
  const rpdLimit = apiKeyInfo.rpd;
  if (rpdLimit != null) {
    const date = getDateKey();
    const current = bumpCounter(counters.rpd, keyId, date, 0);
    if (current + 1 > rpdLimit) {
      return { allowed: false, reason: `Rate limit exceeded: ${rpdLimit} requests per day`, retryAfterMs: 86400000 - (Date.now() % 86400000) };
    }
  }

  // Max tokens per request
  if (apiKeyInfo.maxTokens != null && tokens > apiKeyInfo.maxTokens) {
    return { allowed: false, reason: `Token limit exceeded: max ${apiKeyInfo.maxTokens} tokens per request` };
  }

  // Daily tokens
  if (apiKeyInfo.maxTokensDaily != null) {
    const date = getDateKey();
    const current = counters.tokensDaily.get(keyId);
    const used = current?.key === date ? current.tokens : 0;
    if (used + tokens > apiKeyInfo.maxTokensDaily) {
      return { allowed: false, reason: `Daily token limit exceeded: ${apiKeyInfo.maxTokensDaily}` };
    }
  }

  // 5-hour rolling tokens
  if (apiKeyInfo.tokens5h != null) {
    const used = getRollingTokenCount(counters.tokens5h, keyId, 5 * 3600000);
    if (used + tokens > apiKeyInfo.tokens5h) {
      return { allowed: false, reason: `5-hour token window exceeded: ${apiKeyInfo.tokens5h}` };
    }
  }

  // Weekly tokens
  if (apiKeyInfo.tokensWeekly != null) {
    const week = getWeekKey();
    const current = counters.tokensWeekly.get(keyId);
    const used = current?.key === week ? current.tokens : 0;
    if (used + tokens > apiKeyInfo.tokensWeekly) {
      return { allowed: false, reason: `Weekly token limit exceeded: ${apiKeyInfo.tokensWeekly}` };
    }
  }

  // Monthly tokens
  if (apiKeyInfo.tokensMonthly != null) {
    const month = getMonthKey();
    const current = counters.tokensMonthly.get(keyId);
    const used = current?.key === month ? current.tokens : 0;
    if (used + tokens > apiKeyInfo.tokensMonthly) {
      return { allowed: false, reason: `Monthly token limit exceeded: ${apiKeyInfo.tokensMonthly}` };
    }
  }

  return { allowed: true };
}

/**
 * Record request usage against a key's counters.
 * @param {object} apiKeyInfo
 * @param {number} tokensUsed - total tokens consumed (prompt + completion)
 */
export function recordApiKeyUsage(apiKeyInfo, tokensUsed = 0) {
  if (!apiKeyInfo) return;
  const keyId = apiKeyInfo.id;
  const tokens = Math.max(0, Number(tokensUsed) || 0);

  bumpCounter(counters.rpm, keyId, getMinuteTs(), 1);
  bumpCounter(counters.rph, keyId, getHourTs(), 1);
  bumpCounter(counters.rpd, keyId, getDateKey(), 1);

  if (tokens > 0) {
    bumpTokens(counters.tokens5h, keyId, tokens);

    const date = getDateKey();
    const daily = counters.tokensDaily.get(keyId);
    if (!daily || daily.key !== date) {
      counters.tokensDaily.set(keyId, { key: date, tokens });
    } else {
      daily.tokens += tokens;
    }

    const week = getWeekKey();
    const weekly = counters.tokensWeekly.get(keyId);
    if (!weekly || weekly.key !== week) {
      counters.tokensWeekly.set(keyId, { key: week, tokens });
    } else {
      weekly.tokens += tokens;
    }

    const month = getMonthKey();
    const monthly = counters.tokensMonthly.get(keyId);
    if (!monthly || monthly.key !== month) {
      counters.tokensMonthly.set(keyId, { key: month, tokens });
    } else {
      monthly.tokens += tokens;
    }
  }
}

/**
 * Get current usage snapshot for a key (for dashboard display).
 * @param {object} apiKeyInfo
 */
export function getApiKeyUsageSnapshot(apiKeyInfo) {
  if (!apiKeyInfo) return null;
  const keyId = apiKeyInfo.id;
  return {
    rpm: { limit: apiKeyInfo.rpm, used: (counters.rpm.get(keyId)?.count || 0) },
    rph: { limit: apiKeyInfo.rph, used: (counters.rph.get(keyId)?.count || 0) },
    rpd: { limit: apiKeyInfo.rpd, used: (counters.rpd.get(keyId)?.count || 0) },
    tokens5h: { limit: apiKeyInfo.tokens5h, used: getRollingTokenCount(counters.tokens5h, keyId, 5 * 3600000) },
    maxTokens: { limit: apiKeyInfo.maxTokens, used: null },
    maxTokensDaily: { limit: apiKeyInfo.maxTokensDaily, used: (counters.tokensDaily.get(keyId)?.tokens || 0) },
    tokensWeekly: { limit: apiKeyInfo.tokensWeekly, used: (counters.tokensWeekly.get(keyId)?.tokens || 0) },
    tokensMonthly: { limit: apiKeyInfo.tokensMonthly, used: (counters.tokensMonthly.get(keyId)?.tokens || 0) },
  };
}
