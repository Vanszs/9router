/**
 * Antigravity Weekly Usage Tracker
 *
 * Estimates weekly usage from 7-day rolling request history.
 * Since the Antigravity REST API only returns 5-hour window metrics
 * (remainingFraction), we track actual request patterns to approximate
 * the weekly view shown in the Antigravity Desktop app.
 *
 * Buckets (matching official Antigravity 2.0 grouping):
 *   - Gemini Models: gemini-*, gemini-pro-agent
 *   - Claude & GPT Models: claude-*, gpt-*
 *
 * IMPORTANT: Antigravity quota is measured in REQUESTS (the 5H window is
 * ~1000 requests), NOT tokens. We count request rows in usageHistory,
 * not token sums.
 *
 * Usage notes:
 * - This is an ESTIMATE, not an exact server-side quota.
 * - Weekly total is inferred from the 5H window limit × expected weekly cycles.
 * - More accurate with longer uptime and consistent request flow.
 */

import { getAdapter } from "../../../src/lib/db/driver.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Map model names to their bucket
const BUCKET_RULES = [
  { match: /^gemini-/i, bucket: "gemini_weekly" },
  { match: /^claude-/i, bucket: "claude_gpt_weekly" },
  { match: /^gpt-/i, bucket: "claude_gpt_weekly" },
];

/**
 * Determine which weekly bucket a model belongs to.
 * @param {string} modelName
 * @returns {string|null} Bucket key or null if unknown
 */
function resolveBucket(modelName) {
  if (!modelName) return null;
  for (const rule of BUCKET_RULES) {
    if (rule.match.test(modelName)) return rule.bucket;
  }
  return null;
}

/**
 * Query usageHistory for the last 7 days and compute per-bucket usage.
 * Counts REQUEST rows (Antigravity quota unit), grouped by model bucket.
 *
 * @param {string} connectionId - The Antigravity connection UUID
 * @returns {Promise<{
 *   gemini_weekly: { used: number, total: number, resetAt: string|null, remainingPercentage: number, displayName: string },
 *   claude_gpt_weekly: { used: number, total: number, resetAt: string|null, remainingPercentage: number, displayName: string }
 * }>}
 */
export async function getWeeklyUsage(connectionId) {
  if (!connectionId) {
    return buildEmptyResult();
  }

  try {
    const db = await getAdapter();
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

    // Fetch request rows for this connection within the last 7 days.
    // Count rows (requests), skipping error rows to avoid inflating usage.
    const rows = db.all(
      `SELECT model, timestamp, status
       FROM usageHistory
       WHERE connectionId = ?
         AND timestamp >= ?
       ORDER BY timestamp ASC`,
      [connectionId, cutoff],
    );

    // Accumulate request counts per bucket + track first-use timestamp per
    // bucket. Antigravity's weekly window starts counting down from the first
    // request of that bucket (same principle as the 5H window), so each
    // bucket gets its own weekly reset = firstUse + 7 days.
    const bucketRequests = {
      gemini_weekly: 0,
      claude_gpt_weekly: 0,
    };
    const bucketFirstUse = {
      gemini_weekly: null,
      claude_gpt_weekly: null,
    };

    for (const row of rows) {
      // Skip error rows — they don't consume quota
      if (row.status === "error" || row.status === "failed") continue;

      const model = (row.model || "").trim();
      const bucket = resolveBucket(model);
      if (!bucket) continue;

      bucketRequests[bucket] += 1;
      if (!bucketFirstUse[bucket] || row.timestamp < bucketFirstUse[bucket]) {
        bucketFirstUse[bucket] = row.timestamp;
      }
    }

    // Scale to a full 7-day window if we only observed a partial window.
    // This estimates what usage WOULD look like over the full week.
    let observedAny = Object.values(bucketRequests).some((v) => v > 0);
    if (observedAny) {
      const timestamps = [];
      for (const bucket of Object.keys(bucketRequests)) {
        if (bucketFirstUse[bucket]) timestamps.push(bucketFirstUse[bucket]);
      }
      const earliest = timestamps.length ? new Date(Math.min(...timestamps.map((t) => new Date(t).getTime()))) : null;
      const latestTs = timestamps.length ? new Date(Math.max(...timestamps.map((t) => new Date(t).getTime()))) : null;
      if (earliest && latestTs) {
        const actualMs = latestTs.getTime() - earliest.getTime();
        if (actualMs > 0 && actualMs < SEVEN_DAYS_MS) {
          const scale = SEVEN_DAYS_MS / actualMs;
          for (const key of Object.keys(bucketRequests)) {
            bucketRequests[key] = Math.round(bucketRequests[key] * scale);
          }
        }
      }
    }

    // Estimated weekly total per bucket (requests). The 5H API reports
    // total=1000 requests per window; the real weekly pool (shown in the
    // Antigravity app) is smaller than 7× the 5H pool — typically 3-5×.
    // Use a conservative 4× multiplier = 4000 requests per week.
    const WEEKLY_ESTIMATED_TOTAL = 4000;

    const result = {};

    for (const [bucketKey, displayName] of [
      ["gemini_weekly", "Gemini Models"],
      ["claude_gpt_weekly", "Claude & GPT Models"],
    ]) {
      const used = bucketRequests[bucketKey] || 0;
      const total = WEEKLY_ESTIMATED_TOTAL;
      const remainingPercentage = total > 0
        ? Math.max(0, Math.round(((total - used) / total) * 100))
        : 100;

      // Per-bucket weekly reset: first use of this bucket + 7 days.
      // If the bucket hasn't been used yet, show a full 7d window from now.
      const firstUseMs = bucketFirstUse[bucketKey]
        ? new Date(bucketFirstUse[bucketKey]).getTime()
        : Date.now();
      const resetAt = new Date(firstUseMs + SEVEN_DAYS_MS).toISOString();

      result[bucketKey] = {
        used,
        total,
        resetAt,
        remainingPercentage,
        unlimited: false,
        displayName,
        isWeekly: true, // Flag for UI differentiation
        estimated: true, // Weekly totals are estimates (7-day request history scaled + 4x multiplier), not provider-reported
      };
    }

    return result;
  } catch (error) {
    console.error("[Antigravity WeeklyTracker] Error:", error.message);
    return buildEmptyResult();
  }
}

function buildEmptyResult() {
  const resetAt = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();
  return {
    gemini_weekly: {
      used: 0, total: 4000, resetAt,
      remainingPercentage: 100, unlimited: false,
      displayName: "Gemini Models", isWeekly: true, estimated: true,
    },
    claude_gpt_weekly: {
      used: 0, total: 4000, resetAt,
      remainingPercentage: 100, unlimited: false,
      displayName: "Claude & GPT Models", isWeekly: true, estimated: true,
    },
  };
}
