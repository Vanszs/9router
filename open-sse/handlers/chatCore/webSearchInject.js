/**
 * When web search is enabled for a chat request:
 * 1) Append an OpenAI-style web_search function tool (for agentic clients)
 * 2) Optionally pre-fetch DuckDuckGo results for the latest user message and
 *    inject them as a system note so streaming chat still gets live context
 *    without a multi-turn tool loop.
 */

import { searchDuckDuckGo } from "../search/adapters/duckduckgo.js";

export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the public web for current information. Returns titles, URLs, and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
    },
  },
};

function lastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string") return c.trim();
    if (Array.isArray(c)) {
      return c
        .map((p) => (typeof p === "string" ? p : p?.text || p?.content || ""))
        .filter(Boolean)
        .join(" ")
        .trim();
    }
  }
  return "";
}

function formatResults(results) {
  if (!results?.length) return "No web results found.";
  return results
    .map((r, i) => `${i + 1}. ${r.title || r.url}\n   ${r.url}\n   ${r.snippet || ""}`)
    .join("\n\n");
}

/**
 * @param {object} body - OpenAI-style request body (mutated)
 * @param {{ enabled?: boolean, maxResults?: number, preFetch?: boolean, log?: object }} opts
 * @returns {Promise<{ injectedTool: boolean, prefetched: boolean, resultCount: number }>}
 */
export async function applyWebSearchToBody(body, opts = {}) {
  const enabled = !!opts.enabled;
  const summary = { injectedTool: false, prefetched: false, resultCount: 0 };
  if (!enabled || !body || typeof body !== "object") return summary;

  // Strip the flag itself so upstream providers that don't recognize it
  // (e.g. NVIDIA NIM) don't reject it with 400 "Unsupported parameter".
  delete body.web_search;
  delete body.webSearch;
  if (body.extra_body) delete body.extra_body.web_search;

  // Do NOT inject the web_search function tool: models that see it in the tools
  // list tend to call it instead of using the prefetched results, which creates a
  // tool_call response the proxy can't execute (no server-side tool loop yet).
  // Prefetching results into the system prompt is sufficient for v1.

  // Prefetch context so streaming completions still see live web data.
  if (opts.preFetch !== false) {
    const query = lastUserText(body.messages);
    if (query) {
      try {
        const { results } = await searchDuckDuckGo({
          query: query.slice(0, 400),
          maxResults: opts.maxResults || 5,
        });
        summary.resultCount = results.length;
        summary.prefetched = true;
        const block = `[Web search results for: ${query.slice(0, 120)}]\n\n${formatResults(results)}\n\nUse these results when relevant. Cite URLs when possible.`;
        const messages = Array.isArray(body.messages) ? [...body.messages] : [];
        messages.unshift({ role: "system", content: block });
        body.messages = messages;
        opts.log?.info?.("WEBSEARCH", `prefetched ${results.length} results for "${query.slice(0, 60)}"`);
      } catch (err) {
        opts.log?.warn?.("WEBSEARCH", `prefetch failed: ${err?.message || err}`);
      }
    }
  }

  return summary;
}

/** Parse request-level web search flag from body + headers + settings.
 *  provider arg (optional) restricts default-on to Gemini CLI / Vertex (mirrors Kick). */
export function resolveWebSearchEnabled(body, request, settings = {}, provider = null) {
  if (body?.web_search === true || body?.webSearch === true) return true;
  if (body?.web_search === false || body?.webSearch === false) return false;
  if (body?.extra_body?.web_search === true) return true;
  const header = request?.headers?.get?.("x-web-search") || request?.headers?.get?.("X-Web-Search");
  if (header === "1" || header === "true" || header === "yes") return true;
  if (header === "0" || header === "false") return false;
  // Default-on only for Gemini CLI / Vertex (built-in googleSearch grounding).
  if (!settings.webSearchEnabled) return false;
  if (provider && provider !== "gemini-cli" && provider !== "vertex") return false;
  // Kick gating: only when no tools declared and no controlled (JSON) generation.
  if (requestDeclaresTools(body) || requestUsesControlledGeneration(body)) return false;
  return true;
}

function requestDeclaresTools(body) {
  const t = body?.tools;
  return Array.isArray(t) && t.length > 0;
}

function requestUsesControlledGeneration(body) {
  const rf = body?.response_format;
  const t = rf && typeof rf === "object" ? rf.type : "";
  if (t === "json_schema" || t === "json_object") return true;
  return false;
}
