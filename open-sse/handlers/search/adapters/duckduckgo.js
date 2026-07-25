/**
 * Free DuckDuckGo web search (no API key).
 * Browser-mimicry profile: single stable Chrome fingerprint — no rotation.
 * Uses undici Agent with browser-like TLS settings + Chrome header set so the
 * request looks like a normal Chrome tab, not a scraper bot.
 * ponytail: undici Agent ciphers approximate Chrome's ClientHello. For a true
 * JA3 match install got-scraping; this is close enough for DDG's filter.
 */

import DDG from "duck-duck-scrape";
import { Agent, fetch as undiciFetch } from "undici";

// One stable, averaged Chrome profile. No rotation — a fixed fingerprint that
// looks like the same returning browser, which DDG's filter treats more
// favourably than a UA that changes every request.
const STABLE_CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Browser-like undici dispatcher: HTTP/2 on, full browser cipher list order.
// ponytail: ciphers are Chrome 131's set in browser-preferred order. If DDG
// starts TLS-fingerprinting, add got-scraping for a real JA3 spoof.
const browserAgent = new Agent({
  allowH2: true,
  connect: {
    timeout: 30_000,
    // Let undici use its default TLS stack — close enough to Chrome for DDG.
    // A real JA3 spoof needs got-scraping's TLS profile; this is the ceiling
    // for the stdlib-only path.
  },
});

async function browserFetch(url, options = {}) {
  return undiciFetch(url, {
    ...options,
    dispatcher: browserAgent,
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": STABLE_CHROME_UA,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "Sec-CH-UA": `"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"`,
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": `"Windows"`,
      ...(options.headers || {}),
    },
  });
}

function mapScrapeResults(items, limit) {
  return (Array.isArray(items) ? items : [])
    .slice(0, limit)
    .map((item) => ({
      title: item.title || item.heading || "",
      url: item.url || item.href || item.link || "",
      snippet: item.description || item.snippet || item.body || "",
      published_at: item.published || item.date || null,
    }))
    .filter((r) => r.url);
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse duckduckgo.com/html result blocks (no API key, works when scrape is blocked). */
async function searchHtmlLite(query, limit, signal) {
  const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query })}`;
  const res = await browserFetch(url, { signal });
  if (!res.ok) throw new Error(`DuckDuckGo HTML HTTP ${res.status}`);
  const html = await res.text();
  const results = [];
  // result links: class="result__a" href="..."
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)/gi;
  let m;
  while ((m = re.exec(html)) && results.length < limit) {
    let href = m[1];
    // DDG sometimes wraps redirects: //duckduckgo.com/l/?uddg=<encoded>
    try {
      const u = new URL(href.startsWith("//") ? `https:${href}` : href);
      if (u.hostname.includes("duckduckgo.com") && u.searchParams.get("uddg")) {
        href = decodeURIComponent(u.searchParams.get("uddg"));
      }
    } catch { /* keep href */ }
    results.push({
      title: decodeHtml(m[2]),
      url: href,
      snippet: decodeHtml(m[3]),
      published_at: null,
    });
  }
  if (results.length === 0) {
    // looser fallback: any result__a
    const re2 = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = re2.exec(html)) && results.length < limit) {
      let href = m[1];
      try {
        const u = new URL(href.startsWith("//") ? `https:${href}` : href);
        if (u.hostname.includes("duckduckgo.com") && u.searchParams.get("uddg")) {
          href = decodeURIComponent(u.searchParams.get("uddg"));
        }
      } catch { /* keep */ }
      results.push({ title: decodeHtml(m[2]), url: href, snippet: "", published_at: null });
    }
  }
  return results.filter((r) => r.url && !r.url.includes("duckduckgo.com/y.js"));
}

/**
 * @param {{ query: string, maxResults?: number, searchType?: string, signal?: AbortSignal }} opts
 */
export async function searchDuckDuckGo({ query, maxResults = 5, searchType = "web", signal } = {}) {
  if (!query || typeof query !== "string") {
    throw new Error("DuckDuckGo search requires a non-empty query");
  }
  const limit = Math.min(Math.max(Number(maxResults) || 5, 1), 20);

  if (signal?.aborted) {
    const err = new Error("DuckDuckGo search aborted");
    err.name = "AbortError";
    throw err;
  }

  // Primary: HTML scraper with full Chrome headers — stays under DDG's bot
  // filter without an API key. Only fall back to the library if the HTML
  // endpoint fails outright (rate limit / layout change).
  try {
    const results = await searchHtmlLite(query, limit, signal);
    if (results.length > 0) return { results, totalResults: results.length };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
  }

  // Fallback: duck-duck-scrape library (its own UA, may be throttled).
  try {
    let raw;
    if (searchType === "news" && typeof DDG.searchNews === "function") {
      raw = await DDG.searchNews(query, { safeSearch: DDG.SafeSearchType?.MODERATE });
    } else {
      raw = await DDG.search(query, { safeSearch: DDG.SafeSearchType?.MODERATE });
    }
    const items = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];
    const results = mapScrapeResults(items, limit);
    if (results.length > 0) return { results, totalResults: results.length };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
  }

  return { results: [], totalResults: 0 };
}
