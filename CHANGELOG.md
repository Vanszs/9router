# v0.91.21 (2026-09-03)

## Features

- **Gemini 3.8 Flash Tiered Support & Parity** — Registered `gemini-3.8-flash` in Gemini registry and tiered variants (`gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`) in Antigravity provider registry, CLI menus, and MITM tooling with exact 1M context / 64k output capabilities, pricing ($0.75/$3.75), and quota tracking gauges.
- **Media & Web Search Model Availability** — Resolved virtual and static model IDs for all webSearch (`ag/search`, `kimi/search`, `xai/search`, `gemini/search`, `glm/search`, `ollama-search/search`, `xquik/search`), webFetch (`/fetch`), and media providers across `/v1/models/web`, `/v1/models/info`, and ACL validation layers so media dashboard test cards execute without missing-model errors.
- **Atomic Bulk Custom Model Imports** — Added `addCustomModelsBulk` using atomic SQLite transactions for multi-model imports with deduplication and normalized bulk responses in `/api/models/custom`.
- **Antigravity Search Grounding Multi-Host Fallback** — Routed search grounding to `daily-cloudcode-pa` with automatic fallback to `cloudcode-pa` for resilience.

## Reliability & Security

- **Kiro Social OAuth Namespace & Poll Hardening** — Restricted `targetProvider` in social exchange to the `kiro` provider namespace to prevent connection hijacking, added exponential backoff / retry bounding on device polling network errors, and improved identity match safety.
- **Model Resolution Optimization** — Deduplicated media model resolution across connected, free, and fallback provider paths in `allowedModels.js`.
- **Responses Terminal Event Finalization** — Ensured usage statistics and request logs finalize cleanly when clients close on `response.completed` without trailing sentinels.

## Tests & Verification

- Full test suite verified: **265 test files passed, 13 skipped; 3069 tests passed, 82 skipped** (100% green).
- Production build (`npm run build`) completed cleanly with TypeScript verification.
- Code quality audits: `lint:undef` and `lint:reacthooks` clean.

# v0.91.20 (2026-08-31)

## Features

- **Model catalog refresh** — Added background synchronization from models.dev, expanded provider capability metadata, and registered new GLM, DeepSeek, Grok, Gemini, and Zed model coverage without blocking normal startup.
- **Antigravity web search** — Added Antigravity as a search provider, including provider routing, quota handling, image-size-to-aspect-ratio mapping, and Gemini 3.7 Flash tier support.
- **Xquik search** — Added Xquik search integration with validated provider options, SSRF-safe base URL handling, credential fallback for supported providers, and normalized unified search responses.
- **Zed provider** — Added Zed authentication, model routing, usage/quota tracking, and provider registry integration.
- **Grok CLI bulk import** — Added dashboard and OAuth support for importing multiple Grok CLI accounts.
- **Shared CLI endpoint presets** — Consolidated endpoint presets across CLI tool cards, including Codex, OpenCode, Kilo, Cline, Copilot, Claude, Droid, Hermes, Jcode, and OpenClaw.
- **Codex Spark quota tracking** — Added GPT-5.3-Codex-Spark quota-window tracking and reset-credit support.

## Reliability & Compatibility

- **CommandCode streaming** — Added in-stream error translation, response termination handling, and protocol helper extraction while preserving combo and account-fallback behavior.
- **Responses streaming** — Preserved usage when clients disconnect after terminal events, removed false disconnect logging, and restored passthrough `DONE` termination.
- **Ollama streaming** — Parses final unterminated NDJSON chunks instead of dropping the stream tail.
- **Claude compatibility** — Decloaks tool names for same-format streaming, defaults missing Claude tool types, and preserves provider-specific tool contracts.
- **MiniMax and OpenAI bridges** — Preserves images on matched transports and supports provider-specific reasoning formats.
- **Search failure isolation** — Prevents search-only provider failures from taking chat providers offline.
- **Database runtime** — Supports better-sqlite3 N-API prebuilds on Node 22+ and spreads query parameters correctly in the SQLite adapter.
- **Headroom and RTK** — Adds configurable compression timeout, format-safe/idempotent system prompt injection, and diagnostics before silent translation failures.
- **OAuth resilience** — Updates Cline refresh handling, CodeBuddy Intl OAuth wiring, provider probe timeouts, and undefined-provider guards.

## CodeBuddy

- **CodeBuddy Intl** — Added OAuth/device-code login, provider registration, model catalog parity, stream-only executor handling, and usage reporting.
- **Request preservation** — Keeps client `system` and `developer` instructions, preserves assistant/tool and multimodal content, converts only string user content to typed blocks, and avoids duplicate required system prompts.
- **Quota parsing** — Shares CN/Intl parsing, supports ISO and numeric timestamps, distinguishes malformed payloads from empty quotas, and separates recurring allowance from one-shot bonus packages.
- **Contract tests** — Added executor, quota, capability, and regression coverage for CN/Intl behavior.

## Frontend & Accessibility

- **Provider dashboard** — Added bulk Grok CLI import UI, refreshed provider/model screens, and improved quota presentation.
- **Token saver** — Updated cards and system-injection flows for current request formats.
- **UI robustness** — Improved responsive provider tables, endpoint controls, and model/tool configuration surfaces.

## Release Infrastructure

- **Multi-architecture Docker** — Added mandatory `docker/setup-qemu-action@v3` immediately before `docker/setup-buildx-action@v3`, preventing ARM64 native-module build failures and QEMU instruction stalls.
- **Container naming** — Standardized published GHCR image references to lowercase `ghcr.io/vanszs/vansrouter`.
- **Release validation** — Kept version, changelog, annotated-tag, npm artifact, SQLite smoke-test, and multi-architecture image gates explicit in CI/CD policy.

## Tests

- Full suite verified: **260 test files passed, 13 skipped; 3039 tests passed, 82 skipped**.
- Production build and TypeScript compilation passed.
- `lint:undef`, `lint:reacthooks`, and `git diff --check` passed.

# v0.91.12 (2026-08-25)

- **Multi-arch release CI hardening** — Added `docker/setup-qemu-action@v3` prior to `docker/setup-buildx-action@v3` in the release workflow to resolve ARM64 binfmt registration and prevent QEMU instruction stalls during multi-platform container builds.

# v0.91.11 (2026-08-25)

- **Grok 4.6 full capability & effort scaling** — Added first-class support for `grok-4.6` with regex effort matching (`/^grok-4\.[56](?:$|-)/`), 500k context window registration in provider capabilities, and virtual reasoning effort aliases (`xhigh`, `high`, `medium`, `low`).
- **Grok CLI subscription tier fallback order** — Prioritized authoritative subscription tier data returned by the `/v1/user` billing endpoint, with fallback to JWT token claims.
- **SSE streaming & buffer bypass** — Bypassed 8KB buffer peeking during active stream mode to achieve 0ms time-to-first-token (TTFT) and deterministic Claude billing cache headers.
- **Provider connection probe hardening** — Hardened the Blackbox connection test probe to evaluate `res.ok || res.status === 400` against canonical registry models, eliminating false-positive active status flags on region blocks.
- **Thinking format compatibility** — Registered `thinkingFormat: "openai"` for Bazaarlink and A6API providers to guarantee correct reasoning block delivery.
- **Frontend performance & accessibility** — Removed redundant external Google Font CDN stylesheet link to eliminate 1.2s+ render-blocking FCP delay, memoized O(N²) provider stats calculations during interval polling, optimized image loading with deferred preloading, fixed landing page contrast ratios, and removed dead SSR machine ID extraction.
- **OAuth & Upstream sync** — Added CodeBuddy-Intl OAuth support, Cursor machine ID deduplication precedence, and Codestral transport quirks.

# v0.91.10 (2026-08-19)

- **OpenAI Responses system prompt injection** — Injected Token Saver prompts (Caveman/Ponytail) into `body.instructions` instead of `input[]` for OpenAI Responses / Codex models, preventing `Unknown parameter: 'input[0].content'` (#106 / #2497).
- **Web fetch format routing** — Forwarded `format` parameter (`markdown`, `text`, `html`) to upstream web fetch providers (Jina Reader via `X-Respond-With`, Firecrawl via `formats`, Tavily via `format`).
- **Chat content part type standardization** — Standardized array content parts in Chat completions to `{ type: "text" }` instead of `input_text` for strict upstream providers (#3204).

# v0.91.9 (2026-08-19)

- **Local font bundling** — Bundled Material Symbols locally to eliminate external Google Fonts CDN dependency and removed the fragile `visibility: hidden` font-loading gate.
- **Sidebar changelog modal** — Replaced the external GitHub changelog link in the sidebar with an interactive modal popup matching the navbar experience.
- **Multi-language changelog action** — Added translations for 'Check new changelog' across all 30 supported language literal files.

# v0.91.8 (2026-08-18)

- **Empty reasoning stream recovery** — Emitted a synthetic text delta before stream completion across Gemini and Claude translators when models finish with only thinking content, preventing `APIEmptyResponseError` in AI SDK clients.
- **Search error isolation** — Prevented client input validation errors (HTTP 400 / 422) from triggering account lockouts or provider failovers.
- **Exa Search Playground** — Added interactive 1:1 request playground with coding presets, live cURL preview, and dual-mode JSON/SSE decoder.
- **Material Symbols i18n Guard** — Excluded icon font ligature containers from runtime text translation to prevent corrupted UI controls (#105).
- **Multi-channel Donate** — Configured built-in support for Saweria, Trakteer, and Ko-fi, and updated label to 'Donate Me' with full multi-language translations.

# v0.91.7 (2026-08-18)

- **Exa Search 1:1 Integration** — Full parameter mapping (`type`, `stream`, `numResults`, `category`, `userLocation`, `includeDomains`, `excludeDomains`, dates, `moderation`, `additionalQueries`, `systemPrompt`, `outputSchema`, `compliance`, nested `contents` with text/highlights/summary/livecrawl/subpages/extras), SSE stream response handling, and response metadata preservation.
- **Atomic Bulk Add Provider Connections** — Added `POST /api/providers/bulk` running in a single database transaction with per-batch validation and collision-safe account naming without billable probes on import.

# v0.91.6 (2026-08-17)

- **Kiro region routing** — Hardened commercial-region validation across executor, model catalog, OAuth, refresh, external IdP, and provider-test paths; rejected unsupported AWS partitions and duplicate regional fallbacks.
- **Kiro request recovery** — Kept retry instructions out of the rejected top-level `systemPrompt` field and expanded regression coverage.
- **Provider dashboard** — Reverted commit `3399f6d97c6ca3232baeb84eeeb1f7d975bb5225` per release decision.

# v0.91.5 (2026-08-16)

- **Release tag validation** — Validate the original annotated tag through a temporary ref after GitHub Actions checkout.
- **Release recovery** — Kept failed tags `v0.91.3` and `v0.91.4` immutable; prepared the next recovery release.

# v0.91.4 (2026-08-16)

- **Release tag validation** — Fixed annotated-tag detection after GitHub Actions resolves a tag checkout to its commit.
- **Release recovery** — Kept `v0.91.3` immutable after its gate failure and prepared the next valid release version.

# v0.91.3 (2026-08-16)

- **Release pipeline** — Hardened npm/GHCR promotion with immutable staging, pinned release tooling, global release serialization, and final promotion gates.
- **CLI artifact validation** — Validated the actual npm tarball for bundled `sql-wasm.wasm`, native SQLite exclusion, runtime startup, SQLite initialization, and legacy JSON migration without network access.
- **Release policy** — Added mandatory AI release rules for version alignment, changelog-last commits, annotated tags, deployment checks, and rollback recovery.

# v0.91.2 (2026-08-16)

- **Freebuff routing** — Updated base3 agent mapping, injected the required `end_turn` tool, added clearer upstream gate errors, and added Freebuff auth probing.
- **Freebuff proxy safety** — Enforced proxy-only egress, persisted pool fitness, skipped unhealthy pools, and failed closed when no valid pool exists.
- **Freebuff model assignment** — Added optional strict per-model account assignment in the dashboard and credential selector.
- **CLI SQLite runtime** — Fixed bundled WASM packaging, runtime module resolution, and native SQLite artifact leakage in published packages.

# v0.91.1 (2026-08-15)

VansRouter 0.91.1 introduces Gemini 3.7 tiered model support for Antigravity, comprehensive prompt caching and session affinity hardening, bulk proxy management, and dedicated quota lifecycle tools.

## Provider and model routing

- **Gemini 3.7 Flash support** — Added Antigravity `gemini-3.7-flash-high`, `gemini-3.7-flash-medium`, and `gemini-3.7-flash-low` mapped cleanly to upstream `gemini-3.7-flash-tiered`. Removed ambiguous plain alias while preserving explicit provider ACLs.
- **GLM updates** — Added `glm-5.3` to GLM Coding and GLM (China) provider registries.
- **Upstream provider adoption** — Integrated latest upstream provider updates (Clinepass, Venice, Muse Spark Web, and OpenCode Go transport declarations).
- **Prompt trigger sanitization** — Stripped competitive and identity prompt triggers (Claude, Hermes, Nous) to avoid upstream 429 and rate limit rejections.

## Caching and session affinity

- **Codex Responses cache accounting** — Preserved `input_tokens_details.cached_tokens` across Responses API stream conversions and request details extraction.
- **Tool-call session affinity** — Hardened `accumulateAssistantText` in `sessionManager.js` to extract `tool_calls` and function call arguments, ensuring consistent session hashing across multi-turn agent conversations.
- **Dashboard cache metrics** — Surfaced `Cache Hit Rate (%)` in usage overview cards and normalized input token breakdown calculation.
- **Universal Claude cache anchoring** — Ensured `anchorClaudeCache` executes across all passthrough Claude-format targets.
- **Connection affinity in chat** — Wired `x-connection-id` header to `getProviderCredentials` in chat routing to avoid cache-busting account rotation within a conversation thread.

## Dashboard and management

- **Codex 401 bulk delete** — Added batch action button on `/dashboard/quota` (under Codex filter) to bulk remove connections reporting `Usage API temporarily unavailable (401)` with confirmation and state reconciliation.
- **Proxy pool assignments** — Hardened per-button proxy pool assignment on provider connection rows, ensuring exact pool IDs are preserved, inactive pools are disabled, and UI state reflects authoritative API responses.
- **Performance** — Parallelized remote image prefetching using `Promise.all` during request translation.

## Verification

- Full Vitest suite: **243 test files passed; 2,845 tests passed; 13 skipped; 82 expected skipped/e2e**.
- Production standalone build and PM2 deployment verified on port 3003.
- Live Gemini 3.7 tiered execution verified (HTTP 200).

# v0.9.99 (2026-08-09)

VansRouter 0.9.99 hardens Qoder authentication, proxy-pool batch operations, OAuth callback handling, and SQLite fallback compatibility.

## Provider and runtime fixes

- **Qoder PAT authentication** — Centralized Personal Access Token exchange, short-lived job-token caching, concurrent request deduplication, user resolution, model validation, and upstream stream cancellation coverage.
- **OAuth lifecycle** — Hardened callback state matching, duplicate callback protection, stale-response rejection, and retry behavior across provider auth modals.
- **SQLite fallback** — Restored the legacy `better-sqlite3`/`node:sqlite` → `sql.js` fallback path for compatibility with older runtime behavior.

## Dashboard and maintenance

- **Proxy-pool batches** — Added sequential batch progress reporting, duplicate-input filtering, partial-failure accounting, and extracted batch orchestration helpers.
- **Cleanup** — Removed disabled `got-scraping` code and replaced the client-side UUID helper with the native Web Crypto API.

## Verification

- Full Vitest suite: **232 test files passed; 2,787 tests passed; 13 skipped; 19 expected failures**.
- OpenCode golden header suite: **176 tests passed**.
- `lint:undef`, `lint:reacthooks`, and production build passed.

# v0.9.97 (2026-08-08)

VansRouter 0.9.97 hardens production SQLite packaging and provider display resolution.

## Runtime reliability

- **Native SQLite in Docker** — Explicitly includes `better-sqlite3` and its runtime dependencies in the final image, preserving native multi-process SQLite instead of an unavailable production fallback.
- **Build-time SQLite smoke test** — The image build now fails immediately if the native driver cannot load and execute a query.
- **Release image verification** — CI verifies the published multi-platform manifest and runs a native SQLite query inside the pushed image.
- **Optional dependency install** — Docker builder explicitly installs optional dependencies required by native SQLite.

## UI consistency

- **Risk notice resolution** — Provider registry `RISK_NOTICE` tokens now resolve to the complete warning text on provider pages.

# v0.9.96 (2026-08-08)

VansRouter 0.9.96 resolves sidebar hierarchy, proxy fitness UI alignment, and OAuth device-code provider registration.

## UI and Sidebar updates

- **Proxy Fitness UI** — Polished layout spacing, paddings, tables, empty states, and select controls to match the dashboard design.
- **Sidebar hierarchy** — Grouped *Proxy Fitness* together with *Proxy Pools* under the *System* section for logical hierarchy.
- **Provider logos** — Added extension resolution for PNG-only provider icons (like `freebuff`, `grok-cli`, `venice`) to resolve 404 image errors.

## OAuth and provider integrations

- **OAuth Modal wiring** — Added `"freebuff"` to `deviceCodeProviders` list so device-code auth polling is initiated correctly.

# v0.9.95 (2026-08-08)

VansRouter 0.9.95 hardens GHCR release builds for bounded, reproducible delivery.

## CI/CD fixes

- **BuildKit cache reuse** — Switched intermediate-layer caching from GHCR registry export to the GitHub Actions cache backend with `mode=max`, avoiding a large registry cache manifest upload while retaining reusable `npm install` and build layers.
- **Multi-platform release image** — Retained `linux/amd64` and `linux/arm64` output for runtime compatibility.
- **Smaller Docker context** — Excluded tests, documentation, development tools, generated artifacts, and unrelated runtime files.
- **Reproducible Alpine install** — Removed unpinned `apk upgrade` from the runtime image build.

# v0.9.94 (2026-08-08)

VansRouter 0.9.94 hardens provider response identity, Kiro system-prompt injection, and Issue #98 security consistency.

## Provider and compatibility fixes

- **Client model echo** — Preserved the client-requested model through all response handlers instead of exposing only the upstream model ID.
- **Kiro token-saver prompts** — Injected default, Caveman, and Ponytail prompts into Kiro's native top-level `systemPrompt` field without rewriting conversation messages.
- **Stream compatibility** — Retained existing tool-call cleanup, zero-completion repair, and Gemini/Antigravity response parsing.

## Security and consistency

- **Issue #98** — Retained proxy-pool route authentication, DNS-aware SSRF validation, async validation contracts, forced-SSE usage handling, and no-login compatibility.

## Verification

- Full Vitest suite: **230 test files passed; 2,778 tests passed; 13 skipped; 19 expected failures**.
- Focused provider/Kiro suite: **4 test files passed; 233 tests passed**.
- `lint:undef`, `lint:reacthooks`, and production build passed.

# v0.9.93 (2026-08-08)

VansRouter 0.9.93 hardens proxy-pool administration, forced-SSE usage accounting, and settings-cache consistency.

## Security and consistency

- **Proxy-pool route authentication** — Added consistent dashboard authentication before database, credential, deployment, fitness, and outbound work across all proxy-pool handlers.
- **Forced-SSE usage fallback** — Preserved explicit zero token counts while accepting provider-style prompt/completion usage fields.
- **Cross-process settings invalidation** — Added durable `_meta` revision tracking with transaction-safe rollback behavior for settings updates and database imports.
- **DNS-aware SSRF validation** — Added async DNS resolution, private/mapped IP rejection, and pinned `guardedFetch` for server-side user-configured upstream model discovery. Edge relay guards remain dependency-free.
- **Async validation contract** — Updated SSRF callers and regression tests to await validation failures correctly.
- **No-login compatibility** — Route-level proxy-pool defense-in-depth preserves the configured `requireLogin=false` dashboard mode.

## Verification

- Focused issue #98 suite: **10 test files passed; 91 tests passed**.
- `git diff --check`: existing trailing-whitespace findings remain in pre-existing/issue-scope files; no whitespace cleanup performed.

# v0.9.92 (2026-08-07)

VansRouter 0.9.92 adds FreeBuff support and production-safe single-node proxy-pool fitness persistence.

## New features

- **FreeBuff provider** — Added device-code login, FreeBuff model registry, executor, usage reporting, provider UI integration, icon, and regression coverage.
- **Smart proxy-pool rotation** — Added provider/model-scoped pool fitness, cooldown-based failover, wildcard provider scopes, multi-pool selection, dashboard visibility, and manual clear controls.
- **Proxy transport coverage** — Preserved HTTP, Vercel, Cloudflare, and Deno proxy contracts while extending rotation and strict-proxy handling.

## Persistence and production hardening

- **Atomic fitness persistence** — Stored `(poolId, scope)` fitness records in a dedicated SQLite table with upsert/delete/clear operations instead of full JSON snapshot writes.
- **Restart-safe state** — Fitness state reloads from SQLite, survives process restarts, participates in database export/import, and is removed when a pool is deleted.
- **Single-node production contract** — Production now requires a native SQLite driver. Docker documentation defines one PM2 fork instance per persistent database volume; horizontal scaling requires shared database/backend support.
- **Awaited state transitions** — FreeBuff pool cooldown marks and clears complete before request retry/rotation decisions continue.

## Sources

- FreeBuff login host: <https://freebuff.com>
- FreeBuff session/usage endpoint: <https://www.codebuff.com/api/v1/freebuff/session>
- Implementation: `open-sse/executors/freebuff.js`, `src/lib/oauth/providers/freebuff.js`
- Proxy fitness implementation: `open-sse/services/proxyPoolFitness.js`, `src/lib/db/repos/proxyPoolFitnessRepo.js`
- Deployment contract: `DOCKER.md`, `.env.example`

## Verification

- Full project suite: **227 test files passed, 13 skipped; 2,768 tests passed, 19 expected failures, 82 skipped**.
- Targeted FreeBuff/proxy/DB tests: **31 tests passed**.
- `lint:undef`: clean.
- `lint:reacthooks`: clean.
- Production build: compiled successfully.

# v0.9.91 (2026-08-07)

VansRouter 0.9.91 republishes the corrected CLI package version after the initial 0.9.90 release workflow exposed a package-version mismatch.

## Fixed
- **CLI release version alignment** — Synchronized `cli/package.json` with the application version so the GitHub Release workflow publishes `vansrouter@0.9.91` instead of attempting to republish an existing npm version.

# v0.9.90 (2026-08-07)

VansRouter 0.9.90 is a large compatibility, provider, security, proxy, CLI-tool, usage-tracking, and runtime-hardening release. It incorporates the validated upstream/runtime work accumulated after `v0.9.80`, then adds the VansRouter-specific OpenCode contract fix and release-pipeline corrections.

## New features

### Provider and model support
- **Antigravity native image generation** — Added native image-generation capability and model registrations, including capability metadata and request handling for image models (`7dd8d755f`, `3ef88f1`).
- **Xiaomi MiMo TTS** — Added Xiaomi MiMo text-to-speech provider registration, model metadata, executor integration, handler routing, and unit coverage (`c570fe3`, `3f6f007`).
- **Claude Opus 5 for Kiro** — Added Claude Opus 5 model definitions and Kiro capability mappings (`bca5e75`, `a8a9960`).
- **New provider registry entries** — Added or synchronized API-compatible providers including `api-airforce`, `baidu`, `bazaarlink`, `bluesminds`, `codebuddy-intl`, `kilo-gateway`, `llm7`, `morph`, `poolside`, and `tencent`; refreshed provider registry generation and capability metadata (`de2da19`, `9c40604`, `13d5e1a`).
- **Provider catalog cleanup** — Removed stale/unreachable NVIDIA NIM models, refreshed AgentRouter model entries, added `kimi-k3` and `gpt-5.6-sol`, and removed obsolete `claude-opus-4-7` catalog data (`07c3dda`, `761056e`, `6c85974`).
- **Combo context-length controls** — Added configurable context-length settings for combos and wired the value through API, persistence, dashboard, and tests (`cbd6233`, `ca14053`).
- **No-auth provider rotation** — Added provider proxy-pool selector and rotation UI, including providers that have no configured connections, plus pure proxy-pool selection helpers (`f25d2b5`, `f6c8adf`, `18a8949`).
- **Named tunnels** — Added named Cloudflare tunnel configuration for custom domains, with persistence, lifecycle management, PID handling, and tests (`ccc9c66`, `e45bd73`).
- **Devin CLI** — Added Devin CLI provider support through an ACP stdio executor, CLI resolution, configuration route, provider icon, dashboard card, fixture, and executor tests (`72ec06a`, `d27d164`, `76edb83`).
- **Qoder PAT authentication** — Added end-to-end Personal Access Token connections, validation, PAT exchange deduplication, model refresh, and Qoder executor support (`9c9dd7b`, `d433c0b`, `1eb37db`).
- **Token saver controls** — Added token-saver settings, headroom reporting, PXPIPE integration hooks, and effective payload-savings reporting (`e42bac8`, `da8691f`).

### CLI tools and dashboard
- **OpenCode VansRoute contract** — Restored `VansRoute` as the canonical OpenCode provider key and model prefix. Legacy `9router` provider entries and model prefixes remain readable and migrate automatically on save.
- **OpenCode detection** — Fixed the dashboard/API mismatch where the card read `hasVansRoute` while the GET route only returned `has9Router`, making configured installations appear as "Not configured".
- **OpenCode reset and deletion** — PATCH and DELETE now recognize canonical and legacy provider/model prefixes, including explorer subagent configuration.
- **OpenCode safe writes** — Added HTTP(S) and model validation plus atomic temporary-file replacement, preventing an interrupted write from leaving `opencode.json` truncated (`96497a0`).
- **CLI lifecycle reuse** — Added shared CLI-tool lifecycle handling and updated Claude, Cline, Codex, Kilo, and OpenCode cards to share status/configuration behavior instead of duplicating lifecycle logic.
- **Dynamic compatible providers** — Restored the Apply flow for dynamically configured OpenAI- and Anthropic-compatible providers.
- **Claude Code context setting** — Added configurable maximum context-token support for Claude Code.
- **Provider statistics** — Restored dual-auth statistics, counted free-tier OAuth connections, and derived provider auth modes from the registry rather than duplicated UI assumptions (`ed4d033`, `d651415`, `0ea8105`).
- **Provider and endpoint UI** — Improved provider pages, model selectors, ACL provider lists, proxy-pool controls, quota rows, request details, TTS examples, and endpoint integration behavior.

## Runtime and provider fixes

### Cursor, Kiro, Antigravity, Kimchi, and Codex
- **Cursor model catalog fallback** — Non-success catalog responses now fail fast instead of falling through to a real HTTP/2 request that could hang until the test timeout.
- **Cursor transport resilience** — Adopted the upstream HTTP/2/Connect-RPC and model-resolution compatibility fixes, including safer protobuf handling, tool error handling, model refresh, and retry behavior (`0e9657f`, `9c40604`).
- **Kiro conversation canonicalization** — Added shared conversation normalization, tool-history handling, reasoning-effort mappings, thinking-level support, terminal-stream validation, and safer direct/API-key routing (`open-sse/translator/concerns/kiroConversation.js`, `open-sse/kiroEventStream.js`).
- **Kiro model compatibility** — Added and normalized Claude Opus 5 and GPT-5.6 model families, including dashed model identifiers and context-window metadata.
- **Kiro authentication** — Hardened hybrid authentication, canonical metadata, OAuth expiry handling, and regional/IdC session behavior (`1a2910e`, `471672d`, `13d5e1a`).
- **Antigravity request safety** — Removed unsupported `parametersJsonSchema` and stream-only fields before `v1internal` requests, preserved tool/message indexes, and hardened native image and OAuth flows (`cc229bc`, `27bcef3`, `0e9657f`).
- **Antigravity usage accounting** — Parsed Gemini/Antigravity SSE usage metadata, preserved cached tokens, counted tool calls toward completion usage, and fixed forced-SSE-to-JSON accounting paths (`27bcef3`, `41606a3`).
- **Kimchi OAuth and metadata** — Hardened hybrid auth, canonicalized user-agent/metadata handling, and added OAuth adapter coverage (`1a2910e`, `kimchi` test updates).
- **Codex compatibility** — Updated client-version headers, added refresh-aware model synchronization, preserved Responses formatting, handled fast-tier/capacity SSE, and retained GPT-5.6 Max/Ultra overrides.

### Translators, streaming, and usage
- **Translator cleanup** — Removed dead helpers, replaced unsafe/manual cloning with `structuredClone`, expanded thinking-pattern mappings, and centralized Kiro conversation handling (`eb0982e3`).
- **Claude translation** — Preserved image-only messages and tool/content structures, removed global header caching, and gated `anthropic-beta` by model.
- **Gemini translation** — Removed unsupported JSON Schema keywords, filled empty tool schemas after `$ref` removal, and preserved compatible tool/message payloads.
- **Streaming correctness** — Fixed stream passthrough parameters, zero-completion streams, tool-call-only usage, non-JSON SSE handling, duplicate terminal markers, and forced streaming for JSON clients.
- **Usage persistence** — Added or expanded DeepSeek, Grok CLI, Kimi, Antigravity, embedding, and stream usage handlers; preserved cached-token accounting and tool-call completion counts.
- **Grok quota handling** — Added quota-frame parsing and distinguished subscription free-usage exhaustion from short-lived rate limiting, preventing incorrect retry behavior.
- **Responses Lite tools** — Preserved Responses Lite tool payloads when routing through Chat-compatible providers.

## Security and boundary hardening
- **SSRF protection** — Hardened relay/proxy validation, including IPv6-mapped IPv4 handling, private-network checks, URL normalization, and safer proxy deployment routes (`ae8df6f`, `8ac631d`, `src/shared/utils/ssrfGuard.js`).
- **Reverse-proxy headers** — Sanitized forwarded host/protocol headers and restricted public API-host handling to configured values (`81babc9`, `0b26f3d`).
- **CLI resolution** — Guarded Devin/Qoder CLI resolution against unsafe or invalid executable paths and improved signal/timeout handling.
- **OAuth callback safety** — Preserved external `open` behavior on Windows so xAI/Grok refresh flows continue to work without unsafe local resolution.
- **API-key and ACL boundaries** — Included no-auth providers in ACL provider lists where appropriate, cached API-key validation safely, and retained provider/model access restrictions.
- **Input validation** — Strengthened provider validation, model lookup inputs, public-host configuration, and OpenCode URL/model inputs.

## Database, persistence, and infrastructure
- **Database schema version 4** — Bumped schema version, removed a duplicate column, added date-parsing guards, and introduced the combo context-length migration (`c2139f7`, `dc3a1de`).
- **Migration reliability** — Updated migration registration and SQLite/lowdb compatibility tests; preserved request-log configuration through `ENABLE_REQUEST_LOGS`.
- **Docker standalone output** — Updated Docker/Compose packaging, standalone asset copying, Tailscale binary bundling, host-socket support, and deployment proxy configuration (`f93abd9`, `786b301`).
- **Tailscale and Cloudflare lifecycle** — Improved process/PID management, successor process handling, named tunnels, and deployment configuration.
- **Performance** — Cached `validateApiKey` and proxy-pool lookups, replaced the UUID dependency with native `randomUUID`, and reduced avoidable dashboard/provider requests (`44af73e`).
- **Environment documentation** — Expanded `.env.example` for newly supported runtime, tunnel, proxy, and provider settings.

## Tests and engineering quality
- Added regression coverage for OpenCode settings, Xiaomi MiMo TTS, Antigravity OAuth, Kiro conversation canonicalization, Kimchi OAuth, Devin executor behavior, SSRF relay security, public hosts, ACL provider lists, provider catalog invariants, usage accounting, stream edge cases, combo context length, named tunnels, and DB migrations.
- Updated Vitest configuration so the repository test script always uses the project configuration, tuned concurrency, and decoupled UI-token tests from environment-specific values (`ca14053`).
- Removed dead translator helpers and stale provider artifacts; tightened no-undef and React Hooks lint coverage.
- Local verification recorded for this release: **223 test files passed, 13 skipped; 2,713 tests passed, 19 expected failures, 82 skipped**. Targeted OpenCode route tests: **4 passed**. No-undef and React Hooks lint: **clean**. Production build: **compiled successfully**.
- Cross-platform GitHub Actions matrix verified on **Ubuntu, macOS, and Windows with Node 22 and Node 24**.

## Release and compatibility notes
- The application and CLI package were aligned to the release version. The follow-up `0.9.91` release corrected the CLI package version exposed by the npm workflow after `0.9.90` (`7835afc`, `19b176f`).
- Existing installs retain their local SQLite data and config files. Legacy OpenCode `9router` entries remain readable; saving from the dashboard migrates them to the canonical `VansRoute` contract.


# v0.9.80 (2026-07-22)

VansRouter 0.9.80 incorporates merged Pull Requests (#55, #56, #57) adding Gemini 3.6 Flash / Flash-Lite / Pro support via Google Cloud Code host, classifying Grok CLI free-usage-exhausted 429s as daily quota, unwrapping Antigravity non-stream usage metadata, and optimizing code quality & timers.

## Features
- **Gemini 3.6 Flash Support** ([PR #55](https://github.com/Vanszs/VansRouter/pull/55)) — Added Gemini 3.6 Flash (High / Medium / Low) model tiers for Antigravity provider.

## Fixed
- **Grok Daily Quota 429** ([PR #56](https://github.com/Vanszs/VansRouter/pull/56)) — Classified `subscription:free-usage-exhausted` errors from Grok CLI as `daily_quota` instead of 60s rate limit.
- **Antigravity Usage Metadata** ([PR #57](https://github.com/Vanszs/VansRouter/pull/57)) — Unwrapped `response.usageMetadata` envelope in non-stream requests to prevent 0/0 token recordings in request details.

## Refactoring & Code Quality
- **Timer & Regex Optimization** — Replaced hand-rolled sleep timers with stdlib `node:timers/promises` and consolidated 429 regex patterns.

# v0.9.75 (2026-07-21)

VansRouter 0.9.75 introduces a materialized provider model catalog in SQLite (`cachedProviderModels`), parallelizes dynamic model resolution, switches dashboard pages to native direct fetching with `cache: "no-store"`, and adds background idle preloading for provider icons and font assets.

## Performance & Optimization
- **SQLite Materialized Model Catalog** — Created `cachedProviderModels` table (schema v2) for background non-blocking model catalog persistence and instant 1ms local DB queries.
- **Parallel Upstream Resolution** — Replaced serial `for..of` loop in `allowedModels.js` with `Promise.allSettled` to cut initial `/v1/models` load time from ~16s to ~2.5s and cached response time to 11ms.
- **ACL Deduplication** — Deduplicated `isProviderAllowed` and `isComboAllowed` evaluations per request via `Map` cache, reducing ACL overhead from 500+ calls to ~5 calls.
- **Native Direct Dashboard Fetching** — Replaced legacy ad-hoc `fetchCache.js` with native `fetch(url, { cache: "no-store" })` across dashboard pages for 100% real-time accuracy without manual refresh.
- **Icon & Font Asset Preloading** — Added `preloadProviderIcons` idle background preloader (`requestIdleCallback`) and preconnect font stylesheet links in `RootLayout`.

# v0.9.72 (2026-07-21)


VansRouter 0.9.72 fixes GitHub Actions CI/CD matrix build failures by exporting `getStaticProviderModels`, resolving `no-undef` lint errors, and aligning CI workflows with upstream v0.5.40 updates.

## Fixed
- **CI/CD Build Matrix** — Exported and imported `getStaticProviderModels` in `open-sse/config/providers.js` and `src/app/api/providers/[id]/models/route.js` to eliminate `no-undef` lint errors during GitHub Actions workflow runs.
- **Workflow Reliability** — Aligned cross-platform build matrix runs across Node 22 and Node 24 runners on Ubuntu, MacOS, and Windows.

# v0.9.71 (2026-07-21)

VansRouter 0.9.71 registers two new AI providers (`ZenMux AI` & `TokenRouter`), updates `a6api` referral links, and bumps the version to 0.9.71.

## Features
- **ZenMux AI Provider (`zenmux`)** — Full registration for ZenMux AI (`https://zenmux.ai`) with OpenAI API compatibility, passthrough model support, and embeddings/image generation services.
- **TokenRouter Provider (`tokenrouter`)** — Full registration for TokenRouter (`https://www.tokenrouter.com`) with OpenAI API compatibility, passthrough model support, and embeddings/image generation services.
- **a6api Affiliate Link** — Configured custom referral URL (`https://a6api.com/?auth=register&aff=Ksbw`) for `a6api` provider registration.

# v0.9.70 (2026-07-21)

VansRouter 0.9.70 adds the new `a6api` provider with a curated selection of Top 5 models per provider family (GPT, Claude, Gemini, Grok, etc.), adopts critical upstream v0.5.40 Cursor HTTP/2 AgentService (`agent.api5.cursor.sh`) Connect RPC updates, aligns UsageStats table headers, and optimizes provider icon anti-spam caching.

## Features
- **a6api Provider** — Registration for `a6api` featuring top 5 curated models per brand family (GPT, Claude, Gemini, Grok, DeepSeek, Kimi) with OpenAI API compatibility and passthrough support.
- **Custom a6api Cooldown Logic** — Pure HTTP status code error handling (3s cooldown for transient/network errors; standard fallback for 401/402/404).
- **a6api Visual Branding** — Custom circular conic-gradient `A6` CSS icon for provider cards and dynamic topology maps.

## Adopted Upstream Updates (v0.5.35 → v0.5.40)
- **Cursor HTTP/2 Overhaul (`6994cd1f7`)** — Migrated Cursor IDE upstream from retired `api2.cursor.sh` to raw HTTP/2 Connect RPC `agent.api5.cursor.sh`, adding MCP tool calling, automatic `GetUsableModels`, and bumping client version to 3.12.17.
- **Codex Client Sync (`d587b2a48`)** — Updated Codex `client_version` headers and added refresh-aware model sync.
- **Kiro Reasoning Effort Mapping (`cef5dd4d6`, `eb00222c4`)** — Preserved `reasoning_effort` (`high`, `medium`, `low`) through OpenAI ↔ Kiro translation for GPT-5.6 models (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`).
- **Kiro Stream Terminal Output Validation (`7c7fae395`)** — Added stream payload validation to prevent empty SSE emissions.
- **Translator `service_tier` Pass-through (`c97963c4f`)** — Passed `service_tier` field through OpenAI → Responses conversion.
- **Better-SQLite3 Array Binding Crash Fix (`4f48ab8c7`)** — Resolved parameter array binding crash in SQLite queries.
- **Alicode-Intl Split (`55628eea0`)** — Separated DashScope provider into Alibaba Coding Plan & Model Studio (`alims-intl`).
- **Grok Build Subagent Models (`e0ba66745`)** — Configured Grok Build subagent model selection presets.

## Fixed
- **PR #54 (Gemini RPM & Circuit Breaker)** — Classified Gemini generic per-minute RPM `resource_exhausted` error as a short 60s rate-limit backoff (avoiding 1-hour quota lock loops) and aligned Embeddings handler with `settings.circuitBreakerEnabled`.
- **UsageStats Table Alignment** — Fixed empty provider/model headers by synchronizing account column order and metadata aggregation.
- **Cursor IDE Compatibility** — Resolved Cursor 429 "Update Required" errors via Connect RPC HTTP/2 protocol adoption and version bump to 3.12.17.

# v0.9.63 (2026-07-19)

VansRouter 0.9.63 fixes the AgentRouter validation failures by implementing proper Claude CLI header spoofing during credential checks and validation probes.

## Fixed
- **AgentRouter Validation** — Added support for `agentrouter` validation in route handlers and `testUtils.js` using identical dynamic Claude CLI fingerprint headers.
- **Header Refactoring** — Unified Claude CLI header generation into a shared `buildAgentRouterHeaders` helper to avoid duplication and drift.

# v0.9.62 (2026-07-19)

VansRouter 0.9.62 restores the `prepublishOnly` lifecycle script to the CLI configuration to guarantee that the Next.js standalone server directory (`app/`) is always built and packaged during npm releases.

## Fixed
- **NPM Package Standalone Restoration** — Restored `prepublishOnly` build hook in `cli/package.json` to resolve missing standalone directory errors on global installations.

# v0.9.61 (2026-07-19)

VansRouter 0.9.61 fixes standalone Next.js server runtime issues in clean environments by including explicit dependencies (like `react`, `react-dom`, `node-machine-id`, and `ora`) in the CLI package structure.

## Fixed
- **CLI Runtime Dependencies** — Added `react`, `react-dom`, `node-machine-id`, and `ora` to `cli/package.json` to ensure clean global/local installations have standard runtime dependencies available.

# v0.9.60 (2026-07-19)

VansRouter 0.9.60 introduces granular settings controls for guards (Loop Guard, Circuit Breaker, Semaphore) in the Token Saver dashboard, extracts cleanCookie helper utilities, refactors the validation routes to isolate GraphQL payloads, and handles various robust toggle evaluations.

## Added
- **Guards & Shields Panel** — Added Loop Guard, Circuit Breaker, and Semaphore toggles to the Token Saver dashboard page.
- **Isolate Muse Spark Connection Validation** — Relocated Meta AI GraphQL query payloads from route handlers to their respective executor definitions.

## Fixed
- **Robust Toggle Evaluations** — Fixed boolean evaluations against SQLite integer formats (0/1) for circuit breaker, loop guard, and semaphore toggles.
- **Extracted cleanCookie Utility** — Unified cookie cleaning (sso, ecto_1_sess, __Secure-next-auth) into a shared `cookie.js` utility.

# v0.9.56 (2026-07-19)

VansRouter 0.9.56 restores the visibility of Web Cookie providers in the dashboard, allowing users to configure Meta AI Muse Spark Web cookie-based authentication, and rebases local customizations cleanly onto the latest upstream branch.

## Added
- **Web Cookie Section in Dashboard** — Added a dedicated "Web Cookie Providers" section to the main dashboard providers layout to display cookie-based providers (like Meta AI Muse Spark Web).
- **Muse Spark Web Support** — Restored local integration for Meta AI Muse Spark Web including provider definitions, executor routes, and thinking model selectors.

## Fixed
- **Rebase Customizations** — Resolved git branch conflicts by rebasing local commits onto origin/main, keeping `dompurify` dependencies, custom brand styling, and layout features intact.

# v0.9.55 (2026-07-19)

VansRouter 0.9.55 restores the CLI package scripts for NPM publishing, adopts upstream commits for Kimi dual-auth/flow animations/asset caching, and resolves packaging lints.

## Added
- **CLI Package Scripts** — Restored `build`, `pack:cli`, `publish:cli`, and `postinstall` to `cli/package.json` to ensure postinstall hooks (dynamic SQLite and tray runtime setup) execute during global npm installations.
- **Rename Protection Comment** — Added `comment_name` to `cli/package.json` warning future AI agents against renaming the package to `9router` (which breaks the global updater).
- **Virgin Sandbox Verification** — Verified plug-and-play local installation of the generated `.tgz` package inside a clean `/tmp` directory.

## Adopted from upstream
- **Kimi Dual-Auth (`68566f53d`)** — Integrated OAuth/API-key dual-auth connection, unified `"kimi-coding"` and `"kimi"`, and updated refresh token flows.
- **Flow Animation (`0513bf393`)** — Added dynamic router plasma flow animations to topology edges.
- **Icon & API Cache (`ccb0842d0`)** — Optimized model list page mounting and added a session-level 404 cache to prevent redundant icon spam.

## Fixed
- **Turbopack Dev Server CSS Warn** — Identified and documented the Next.js Turbopack CSS parser bug with Tailwind v4 (hex escape normalization failure on `--shadow-elev` inside `.shadow-[var(...)]`). Provided `npm run dev:webpack` as the recommended workaround for development.
- **Missing PropTypes in Topology** — Added missing `PropTypes` import in `ProviderTopology.js` to resolve eslint no-undef failures.
- **VansAI Branding Preservation** — Retained VansAI custom branding over upstream "9Router" logo updates in the topology layout.
- **WebP Icon Extension Support** — Configured `ProviderIcon` component to support both PNG and WebP formats dynamically.

# v0.9.51 (2026-07-19)

VansRouter 0.9.51 adopts all upstream `decolua/9router` commits from `v0.5.31` to `v0.5.35` and fixes critical packaging, translation, and reasoning leaks.

## Adopted from upstream (v0.5.31–v0.5.35)

### Features
- **Grok Imagine** — Grok video generation via `/v1/videos` endpoint + CLI command (`d6761c6fb`)
- **Grok Build setup** — CLI tool card and settings route for Grok Build (`70e8dc497`)
- **Kiro GPT-5.6 model family** — adds GPT-5.6 model slots to Kiro provider (`b94685b80`)
- **X-9Router-Token-Saver header** — per-request bypass header to skip token savers (`c9926897b`)
- **Thai language translation** — full 1389-key th.json + README.th.md (`0248dd534`)
- **Persian (fa) translations** — UI literals + README.fa_IR.md (`02ccdc2d2`)

### Fixes
- **bulk-add API keys** — no longer overwrites existing keys (`de680e789`)
- **anthropic-version header** — lowercase to prevent duplication on `/v1/messages` (`6acc3bb96`)
- **alicode-intl** — use DashScope compatible-mode endpoint so standard keys work (`8b9cac180`)
- **translator** — strip `client_metadata` when converting `openai-responses` to `openai` (`e567ba800`)
- **thinking** — send explicit `thinking:{type:adaptive}` alongside `output_config.effort` (`ba508f250`)
- **translator** — drop temperature for all Claude models (`9173c29b6`)
- **grok-cli** — surface `expiresAt` so proactive token refresh fires (`7dfb34666`)
- **grok-cli** — align Grok Build with current subscription protocol (`59b782823`)
- **models** — populate capabilities for live-catalog LLM models (`2629218b0`)
- **models** — list compatible provider models in `/v1/models` (`88a8c72d2`)
- **kiro** — improve direct session cache reuse (`9c58ba645`)
- **startup** — skip inactive background services on boot (`27b37705b`)

## Fixed (VansRouter-specific)
- **CLI Packaging (Issue #53)** — Added `"app"` and `"src"` back to the `files` array of `cli/package.json` so the Next.js production build is bundled, raising size from a broken `197 kB` back to a healthy `88.3 MB`.
- **Thinking Concerns ReferenceError** — Resolved `ReferenceError: Cannot access 'fmt' before initialization` in `open-sse/translator/concerns/thinkingUnified.js`.
- **GLM-5.2 Reasoning Leak** — Re-integrated the `effectiveCfg` logic in `thinkingUnified.js` to prevent reasoning leak on `agentrouter` when the client does not explicitly request thinking.
- **Kiro Auto Slot** — Added the missing `{ id: "auto", name: "Auto / Agent default", alias: "auto" }` mapping to Kiro's `defaultModels` in `src/shared/constants/cliTools.js`.
- **NPM Package Rename** — Renamed root package to `"vansrouter-app"`, tests package to `"vansrouter-tests"`, and CLI package to `"vansrouter"`.
- `open-sse/handlers/chatCore.js` — tambah import `extractThinking` dan definisi `reqTag` yang upstream referensikan tapi tidak dideklarasikan
- `open-sse/translator/request/openai-to-kiro.js` — tambah `import { randomUUID } from "node:crypto"`
- `src/app/api/v1/models/route.js` — inisialisasi `liveCapabilitiesById` dan `liveKind` dari hasil live resolver
- `src/app/api/providers/[id]/models/route.js` — ganti `getStaticProviderModels()` yang tidak ada dengan fallback `[]`

## Skipped (sengaja tidak diadopsi)
- Penghapusan ZCode provider — upstream menghapus ZCode; VansRouter tetap mempertahankannya
- Restore branding 9Router — upstream mengembalikan label UI 9Router; dilewati untuk menjaga branding VansAI

# v0.9.5 (2026-07-19)

VansRouter 0.9.5 hardens React-Doctor build diagnostics, optimizes `/masuk` page accessibility contrast, and adds a regression test for the `.9router` data directory and Docker volume persistence.

## Added
- **Database Paths Verification Test** — `tests/unit/database-paths-verification.test.js` asserts `dataDir.js` defines `APP_NAME = "9router"`, `db/paths.js` resolves to `DATA_DIR/db/data.sqlite`, and `docker-compose.yml` keeps the `9router-data` volume mount intact.

## Fixed
- **React-Doctor timer leaks** — `ConnectionRow.js` and `ConnectionsCard.js`: `setInterval(checkCooldown)` now only starts when `modelLockUntil` is set and is unconditionally cleared on unmount.
- **React-Doctor impure state updater** — `UsageTable.js`: `localStorage.setItem` moved out of `setExpanded((prev) => …)` into a dedicated `useEffect([expanded, storageKey])`.
- **React-Doctor abort cleanup** — `login/page.js`: `AbortController` and `timeoutId` hoisted outside `checkAuth` so `useEffect` cleanup reliably aborts fetch and clears timeout on unmount.
- **SSR crash — Language Switcher & Promo Modal** — both components now guard `createPortal(…, document.body)` behind a `mounted` state so the portal only runs after client mount.
- **`/masuk` accessibility contrast** — password label promoted from `font-medium` to `font-semibold text-text-main`; helper paragraph set to `text-sm` to satisfy Lighthouse AAA.

## Changed
- `doctor.config.json` — corrected `projects` target from `"vansrouter-app"` to `"9router-app"`; added `react-doctor/effect-needs-cleanup` to disabled rules (false positive on the conditional `setInterval` pattern).
- `package.json` and `cli/package.json` — version bump to `0.9.5`.

# v0.9.4 (2026-07-16)

VansRouter 0.9.4 fixes source-clone version detection and preserves Docker SQLite data across updates.

## Fixed
- **Version Update Detection** — checks the published `vansrouter` package instead of legacy `9router`.
- **Docker SQLite Volume Persistence** — preserves the `9router-data` volume name.


# v0.9.3 (2026-07-16)

VansRouter 0.9.3 replaces placeholder logos with official icons, aligns multi-name provider assets, removes redundant defaultModel input for custom compatible endpoints, and syncs upstream omnirouter provider additions.

## Added
- **Official WebP Icons** — Replaces 17+ empty placeholder assets with official high-quality logos for Databricks, GitLab, Weights & Biases, Bytez, Galadriel, PublicAI, DeepInfra, Venice, SambaNova, Snowflake, Upstage, AI21 Labs, Vercel, Venice, and Volcengine.
- **Provider Icon Aliasing** — Copies and maps Grok CLI (`grok-cli.webp`) to Grok Web, ClinePass (`clinepass.webp`) to Cline, MiMo Free (`mmf.webp`) to MiMo, and Perplexity Agent (`perplexity-agent.webp`) to Perplexity.

## Fixed
- **Docker SQLite Volume Persistence** — preserves the `9router-data` volume name; renaming it creates a new empty database volume without a Docker or application error.
- **Custom Endpoint API Key Form** — Removes the redundant and confusing `Default Model` field when adding API keys for custom OpenAI/Anthropic compatible endpoints.
- **Next.js Local Image Cache** — Clears dynamic image optimizer cache to force reload of updated provider icons.

## Changed
- Root and CLI package versions bumped to **0.9.3**.

# v0.9.1 (2026-07-11)

VansRouter 0.9.1 fixes the `content-blocked` fallback locking loop, aligns `agentrouter` headers dynamically to bypass WAF edge blocks (405), and includes recent fixes for Responses API compatibility, usage tracking, and CI/lint configurations.

## Added
- **AgentRouter Dynamic Wire Image** — Spoofs Claude Code SDK headers dynamically, matching dynamic user agent and lowercase version/beta headers, and appends `?beta=true` to bypass WAF edge blocks (405).

## Fixed
- **Content-Blocked Fallback Loop** — Prevents error status 400 containing `content-blocked` or `content_blocked` from locking the provider account. The moderation error is surfaced directly to the client instead of triggering endless fallback loops.
- **Responses API / Usage Tracking** — Fixes Responses API compatibility for AI SDKs and usage tracking for Antigravity/Gemini streaming responses.
- **CI & Linting** — Fixes pnpm v10 hoisting on CI runners and undef lint configurations.

# v0.9.0 (2026-07-11)

VansRouter 0.9.0 delivers a major sync with upstream v0.5.30, adds experimental PXPIPE token saver (multimodal prompt compression), integrates Perplexity Agent / Grok CLI / Featherless providers, and resolves critical packaging, environment, and streaming regressions.

## Added
- **Upstream v0.5.30 sync** — cherry-picks 23 upstream commits.
- **PXPIPE Token Saver** — experimental fifth token saver. Claude-format request bodies are rendered as dense PNGs via pxpipe-proxy, cutting input tokens by ~35-60%.
- **New Providers** — Perplexity Agent, Grok CLI (with OAuth device-code flow), and Featherless OpenAI-compatible presets.
- **Proxy Auto-Rotation** — strategy for unauthenticated providers.
- **Headroom Extras** — activation, uninstall UI, and interpreter auto-detection.

## Fixed
- **NPM Package Env Crash** — whitelisted swc-helpers underscore folders (`_`) and bundled `@next/env` inside `app/_nm` to avoid npm's default `node_modules` stripping.
- **SSE Streaming Batching** — disabled Next.js default compression (`compress: false`) to flush SSE chunks immediately to the client without buffering.
- **ZCode OAuth Flow** — restored missing ZCode/Z.ai configuration and helper functions from the merge.
- **Registry Index** — regenerated index to include all 124 local and custom providers.

# v0.8.9 (2026-07-09)

VansRouter 0.8.9 syncs the latest upstream v0.5.20 fixes, hardens production data-directory handling, and cleans up the remaining test/lint regressions.

## Added
- **Upstream v0.5.20 sync** — cherry-picks 9 upstream fixes into `dev`:
  - Headroom dashboard proxy through the Next.js app.
  - `CLAUDE.md` guidance for Claude Code.
  - Claude `max_tokens` vs thinking-budget reconciliation.
  - Kiro native system-prompt delivery and Opus 4.5/4.7/4.8 model slots.
  - Structured Anthropic block token counting.
  - JS-native git-log RTK filter.
  - VolcEngine Ark GLM-5 `max_tokens` clamping.
  - Kimi `reasoning_effort` normalization.
  - Upstream-aligned Caveman style rules.
  - Developer-message preservation in OpenAI Responses conversion.
  - MITM stale lock-file recovery on startup.

## Fixed
- **DATA_DIR smoke/temp guard** — `src/lib/dataDir.js` now refuses to use a temp/smoke directory (e.g. `/tmp/9router-data-smoke5`) when running in production or under PM2, falling back to the persistent `~/.9router` default. Prevents the "DB kosong" symptom when `.env` accidentally points at an ephemeral path.
- **useCircuitBreakers hook** — moves the async polling logic inside `useEffect` and adds a `cancelled` cleanup flag, eliminating the `react-hooks/set-state-in-effect` lint error introduced by the circuit-breaker dashboard UI.
- **Golden snapshot drift** — updates `golden-url-header` and `golden-request` snapshots after the ClinePass provider fix and upstream v0.5.20 translator changes.
- **Flaky 429 cooldown test** — widens the assertion tolerance for `resetsAtMs` so the test no longer fails on 1 ms timing drift.
- **ESLint ignore** — excludes generated `.next-cli-build/**` artifacts from linting.

## Changed
- Root and CLI package versions bumped to **0.8.9**.

## Verified
- `pnpm test` → 169 test files passed / 13 skipped / 2044 tests passed / 18 expected fail / 84 skipped.
- `pnpm lint` → 0 errors.
- `pnpm lint:undef` → clean.
- `pnpm lint:reacthooks` → clean.
- `pnpm run build` → build complete.
- `pm2 start .next/standalone/server.js --name 9router` → online, DB file `~/.9router/db/data.sqlite`.

# v0.8.8 (2026-07-08)

VansRouter 0.8.8 adds the first community-built dashboard enhancement and continues the `go-port` work in parallel.

## Added
- **Circuit breaker dashboard UI** — adds `CircuitBreakerBadge` to provider cards, live status polling, retry countdown, and manual reset. Includes `GET /api/providers/circuit-breakers` and `POST /api/providers/circuit-breakers/[name]/reset` (authenticated). Merged from fork PR [#17](https://github.com/Vanszs/VansRouter/pull/17) by @mahdiwafy.

## Go port (experimental)
- **Proxy-aware network layer** — ports connection-level proxy resolution, outbound proxy env management, proxy tester, and per-request proxy wiring. Merged from fork PR [#20](https://github.com/Vanszs/VansRouter/pull/20) by @mahdiwafy.
- **11 missing provider executors** — ports additional executors to Go. Merged from fork PR [#21](https://github.com/Vanszs/VansRouter/pull/21) by @mahdiwafy.
- **Dashboard handlers for proxy-pools, provider-nodes, and models** — replaces 21 stub routes with real SQLite-backed CRUD handlers. Merged from fork PR [#22](https://github.com/Vanszs/VansRouter/pull/22) by @mahdiwafy.

## Fixed
- **Contributors section in README** — adds a `contrib.rocks` badge so contributors remain visible while GitHub's forked-repo Insights graph shows no data.
- **README comparison table** — rewrites the Logic & Backend comparison to be architecture-focused and removes provider-specific selling points.

# v0.8.7 (2026-07-07)

VansRouter 0.8.7 is a focused patch release that fixes the broken ClinePass provider and welcomes two new community contributions.

## Added
- **ClinePass API-key authentication** — ports the upstream fix so ClinePass authenticates with an API key from `app.cline.bot/settings/api-keys` instead of the broken IDE-extension OAuth flow. Merged from upstream PR [#2332](https://github.com/decolua/9router/pull/2332) by @adentdk.
- **ClinePass response envelope handling** — unwraps `{success, data}` responses from the ClinePass/Vercel proxy and retries once on transient empty responses. Merged from upstream PR [#2332](https://github.com/decolua/9router/pull/2332) by @adentdk.
- **ClinePass thinking budget floor** — enforces a 4096 `max_tokens` floor on reasoning models so they do not return empty content. Merged from upstream PR [#2332](https://github.com/decolua/9router/pull/2332) by @adentdk.
- **Migration guide** — adds `docs/MIGRATION.md` with zero-downtime steps for migrating from 9Router to VansRouter, plus improved `docker-compose.yml` and `.env.example`. Merged from fork PR [#13](https://github.com/Vanszs/VansRouter/pull/13) by @mahdiwafy.

## Fixed
- **Migration 002 idempotency** — makes the `002-fix-empty-allowed-lists` migration safe for pre-ACL legacy databases by checking `PRAGMA table_info(apiKeys)` before each `UPDATE`. Merged from fork PR [#12](https://github.com/Vanszs/VansRouter/pull/12) by @mahdiwafy.
- **ClinePass model aliases** — shortens exposed model IDs from `cline-pass/<model>` to `<model>` while preserving the upstream-prefixed ID internally.
- **ClinePass icon** — aligns the ClinePass dashboard icon with the Cline provider (`smart_toy`).

## Verified
- `pnpm test tests/unit/clinepass-provider.test.js` → 5/5 passed.
- `pnpm run build` → build complete.

# v0.8.6 (2026-07-05)

VansRoute 0.8.6 combines the latest VansRouter fork improvements with upstream enhancements from `decolua/9router`, reshaping everything into a faster, more personal AI gateway. Changes are listed by author so every contributor is visible.

## Added
- **API key secret management and directory handling** — improves how API-key secrets are stored and resolved, plus fixes directory handling for data paths. Merged from fork commit `c5171b47` by **@29nls**.
- **Cache invalidation after key creation** — `EndpointPageClient` now refreshes its cache after a new API key is created so the new key appears immediately. Merged from fork commit `c5171b47` by **@29nls**.
- **Standalone instrumentation import fix** — adds a build-time fix so the standalone output loads instrumentation correctly. Merged from fork commit `c5171b47` by **@29nls**.
- **ClinePass provider support** — new provider registration with OAuth flow and model discovery. Merged from upstream commit `f1003019` by @sternelee.
- **Codex auto-ping scheduler** — generalizes the existing Claude auto-ping so it also keeps Codex's 5-hour session window warm after a reset. Merged from upstream commit `7d7b5006` by @Emirhan.
- **Codex reset-credit inspector** — read-only endpoint and service that expose how many Codex rate-limit reset credits remain and when they expire. Merged from upstream PR [#2290](https://github.com/decolua/9router/pull/2290) by @raflyazf.
- **Cached-token cost tracking** — surfaces `cached_tokens` and `cache_creation_input_tokens`, and corrects cost math so cache-creation tokens are not double-counted. Merged from upstream PR [#2209](https://github.com/decolua/9router/pull/2209) by @hodtien.
- **Xiaomi TokenPlan region selector** — region-aware connection setup, improved key validation, and multi-connection support for compatible providers. Merged from upstream PR [#2251](https://github.com/decolua/9router/pull/2251) by @MiQieR.
- **NVIDIA model expansion** — adds newer models and capabilities for the NVIDIA provider.
- Regression tests for Claude foreign-thinking passthrough, Kiro regional IdC routing, GLM/fireworks repeated tool-call IDs, ClinePass, Xiaomi multi-connection, and cached-token cost.

## Fixed
- **DATA_DIR import path** — corrects the import path used for `DATA_DIR` so database/data resolution stays consistent. Merged from fork commit `c5171b47` by **@29nls**.
- **GitBook Pages deployment workflow** — updates the GitHub Pages deployment configuration so the documentation site publishes reliably. Merged from fork commit `81ca1ff0` by **@29nls**.
- **GitBook Pages content-write permission** — adds the `contents: write` permission required by the GitBook Pages deployment job. Merged from fork commit `81ceafc4` by **@29nls**.
- **Claude foreign-thinking passthrough** — drops non-user-facing `thinking` signatures in passthrough mode so downstream clients never receive unexpected content blocks. Merged from upstream commit `47ee418a` by @decolua.
- **Kiro regional IdC auth** — routes Kiro Identity Center authentication to the correct regional CodeWhisperer surface and drops an invalid placeholder ARN. Merged from upstream PR [#2297](https://github.com/decolua/9router/pull/2297) by @lossless1.
- **Headroom tool-history safety** — skips unsafe response entries when building tool history for providers that need headroom. Merged from upstream issue [#2132](https://github.com/decolua/9router/issues/2132) by @Sutarto Jordan Chrisfivo.
- **OpenCode Go GLM tool-call ids** — prevents repeated or malformed tool-call identifiers when using GLM models through OpenCode. Merged from upstream commit `65d0fd56` by @decolua.
- **CodeBuddy-CN bonus packs** — bonus packs are now shown as one-time purchases instead of monthly-replenishing plans. Merged from upstream commit `9524411c` by @decolua.
- **CodeBuddy-CN empty tool_calls** — strips empty `tool_calls` arrays so reasoning streams remain intact. Merged from upstream commit `a93958ea` by @decolua.
- **Kiro Claude Sonnet 5 support** — adds the new Sonnet 5 model slot for Kiro. Merged from upstream PR [#2264](https://github.com/decolua/9router/pull/2264) by @SemonCat.
- **Streaming request-detail deduplication** — shares a single `streamDetailId` between placeholder and final usage rows so the database upsert merges correctly instead of creating duplicates. Merged from upstream commit `c479fc9a` by @Qin Li.

## Changed
- The legacy `claudeAutoPing.js` service has been replaced by a generalized `quotaAutoPing.js` service. The existing `claudeAutoPing` settings key is preserved, so current configurations continue to work.

## Verified
- `pnpm test` → 170 test files passed / 13 skipped / 2040 tests / 0 failures.
- `pnpm run build` → build complete.
- `pm2 start .next/standalone/server.js --name 9router` → online on port 3003.

## Install
```bash
npm install -g vansrouter
# or pull the image
docker pull ghcr.io/vanszs/vansrouter:0.8.6
```

# v0.8.4 (2026-07-03)

Hotfix for Antigravity streaming failures. Ports two upstream `decolua/9router` fixes that caused `API Error: Content block not found` / `API returned an empty or malformed response (HTTP 200)` on Antigravity models.

## Fixed
- **Antigravity/Gemini → Claude tool-call stream state collision** (`open-sse/translator/response/gemini-to-openai.js`):
  - `geminiToOpenAIResponse()` was pre-populating the shared `state.toolCalls` map, which the downstream `OpenAI → Claude` translator also uses for Claude `content_block_start` metadata.
  - When a response contained a `functionCall`, Claude deltas were emitted without a matching `content_block_start`, causing clients to crash with `Content block not found` over an HTTP 200 stream.
  - Fix: keep Gemini bookkeeping in a separate `state.geminiToolCallCount` counter.
  - Upstream reference: `decolua/9router` [#2225](https://github.com/decolua/9router/issues/2225), [#2248](https://github.com/decolua/9router/pull/2248).
- **Antigravity executor drops empty `parts` after thought filtering** (`open-sse/executors/antigravity.js`):
  - After stripping `thought`-only / `thoughtSignature`-only parts, a content entry could be left with `parts: []`.
  - Google `v1internal` rejects empty `parts` arrays with `400 INVALID_ARGUMENT`; the Antigravity client surfaces this as a malformed response.
  - Fix: filter out any content entry whose `parts` array becomes empty after transformation.
  - Upstream reference: `decolua/9router` [#2191](https://github.com/decolua/9router/issues/2191).

## Tests
- Added regression test: `Antigravity → Claude` tool-call streaming asserts that `input_json_delta` carries a valid Anthropic block index.
- Added regression test: Antigravity executor strips content entries that end up with empty `parts`.
- Updated `tests/translator/claude-kiro-direct.test.js` to assert `jsonDelta.index` is defined.

## Verified
- `pnpm test --run tests/translator/` → 324 passed / 18 expected fail / 28 skipped.
- `pnpm test --run tests/unit/` → 1657 passed / 49 skipped.
- `pnpm run build` → build complete.

## Install
```bash
npm install -g vansrouter
# or pull the image
docker pull ghcr.io/vanszs/vansrouter:0.8.4
```

# v0.8.3 (2026-07-02)

Maintenance release that fixes the `npm run dev` startup error, hardens legacy database upgrades, and cleans up bundling/standalone edge cases.

## Added
- **Database migration 003** (`src/lib/db/migrations/003-add-allowed-lists-columns.js`): idempotently adds `allowedProviders`, `allowedCombos`, and `allowedKinds` columns to the settings table for databases created before these ACL fields were introduced. Fixes the `no such column: allowedProviders` login error on legacy installs.
- **Long-lived cache headers** (`next.config.mjs`): provider icons and `/_next/static` assets are now served with `public, max-age=31536000, immutable`.

## Fixed
- **`npm run dev` better-sqlite3 `fs` error** (`src/instrumentation.js`, `src/sse/services/kimchiQuotaReactivation.js`):
  - Force `runtime = "nodejs"` and skip instrumentation work in development so webpack does not bundle server-only code.
  - Inline `buildKimchiQuotaReactivatedUpdate` to cut the import chain into the provider registry (which pulls in Node built-ins like `os`).
  - Use `/* webpackIgnore: true */` with a relative path for the `localDb` dynamic import so `better-sqlite3` stays out of the dev webpack bundle.
- **SearXNG test timeouts** (`tests/unit/all-endpoints-robust.test.js`): skip the SearXNG reachability test when no local instance is running at `127.0.0.1:8888`, preventing 5-second hangs on most dev machines.
- **Version snapshot** (`tests/translator/__snapshots__/golden-url-header.test.js.snap`): regenerated for `VansRouter/0.8.3`.
- **Build / standalone edge cases** (`6220e12d`):
  - `@swc/helpers` bundling fix.
  - Windows standalone EPERM symlink handling (`scripts/fix-standalone-symlinks.cjs`).
  - DB safety backup before builds.
  - Provider pagination fix.
- **Provider page lint** (`06ba55e2`): removed an unused `eslint-disable` directive.

## Changed
- **Version bump**: `package.json` and CLI `package.json` moved to `0.8.3`.

## Tests
- Full suite: **1979 passed, 18 expected fail, 77 skipped** (run on `dev` before merge).
- Note: `tests/unit/mark-account-unavailable-429.test.js` is intermittently flaky when the whole suite runs (1 ms timing drift on a 90 s cooldown); it passes in isolation and is unrelated to this release.

## Verified
- `pnpm lint:undef` → clean.
- `pnpm lint` → 0 errors (474 pre-existing warnings).
- `pnpm run build` → build complete.
- `npm run dev` → starts without the `Can't resolve 'fs'` error.

## Install
```bash
npm install -g vansrouter
# or pull the image
docker pull ghcr.io/vanszs/vansrouter:0.8.3
```

# v0.8.0 (2026-07-01)

Major provider expansion + resilience improvements. This release syncs AgentRouter and Kimchi catalogs with OmniRoute, ports 22 additional OpenAI-compatible API-key providers, hardens combo/account-fallback abort handling, and adds per-provider resilience profiles.

## Added
- **22 new providers** ported from OmniRoute (`open-sse/providers/registry/`):
  `ai21`, `alibaba`, `baseten`, `bytez`, `codestral`, `databricks`, `deepinfra`, `friendliai`, `galadriel`, `gigachat`, `heroku`, `llamagate`, `nanogpt`, `nscale`, `ovhcloud`, `predibase`, `publicai`, `sambanova`, `snowflake`, `upstage`, `volcengine`, `wandb`.
  All are simple OpenAI-compatible, API-key (`bearer`) providers using the default executor.
- **Provider validation test** (`tests/unit/omniroute-ported-providers.test.js`): asserts every ported provider is registered exactly once, has the required registry shape, builds into `PROVIDERS`/`PROVIDER_MODELS`, and has unique model ids.
- **Provider resilience profiles** (`open-sse/config/providerProfiles.js`): per-auth-category thresholds/windows/cooldowns (`oauth`/`apikey`/`local`) with environment overrides for large pools.
- **Combo per-target timeout + client-signal propagation** (`open-sse/services/combo.js`, `src/sse/handlers/chat.js`, `open-sse/config/runtimeConfig.js`): each combo target is now raced against `COMBO_TARGET_TIMEOUT_MS` (default 30 s) and aborted on timeout or client disconnect.
- **Account semaphore immediate cleanup** (`open-sse/services/accountSemaphore.js`): switches from 5-minute idle cleanup to immediate cleanup.
- **Circuit-breaker window-aware failure counting** (`open-sse/utils/circuitBreaker.js`): opt-in `failureWindowMs` for sliding-window counting.
- **Quota Tracker per-model filter** (`src/app/(dashboard)/dashboard/usage/components/ProviderLimits/`): compact provider dropdown + model filter for multi-model providers (`antigravity`, `gemini-cli`).

## Changed
- **AgentRouter/Kimchi catalog sync** (`open-sse/providers/registry/agentrouter.js`, `open-sse/providers/registry/kimchi.js`, `open-sse/providers/shared.js`):
  - AgentRouter models: `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`, `glm-5.2`, `gpt-5.5`.
  - Kimchi models: `kimi-k2.7`, `minimax-m3`, `nemotron-3-ultra-fp4`, `deepseek-v4-flash`.
  - AgentRouter Claude CLI spoof headers synced with OmniRoute (`claude-cli/2.1.195`, `X-Stainless-Runtime-Version: v24.3.0`, full `anthropic-beta` list).
- **Account fallback** (`open-sse/services/accountFallback.js`): now reads profile-specific `providerFailureThreshold`, `providerFailureWindowMs`, and `providerCooldownMs`.
- **Handlers** (`src/sse/handlers/chat.js`, `tts.js`, `search.js`, `imageGeneration.js`, `fetch.js`): pass per-combo `targetTimeoutMs` and `queueDepth` into `handleComboChat`.

## Fixed
- **Client-abort fallback loop** (`src/sse/handlers/chat.js`, `open-sse/handlers/chatCore.js`): client disconnect now short-circuits the account fallback loop and propagates to upstream fetches via `streamController.abort()`.

## Tests
- Full suite: **1963 passed, 18 expected fail, 75 skipped**.
- New tests: `tests/unit/combo-error-paths.test.js`, `tests/unit/provider-resilience-profiles.test.js`, `tests/unit/account-semaphore.test.js`, `tests/unit/omniroute-ported-providers.test.js`.
- Snapshot churn: `tests/translator/__snapshots__/golden-url-header.test.js.snap` regenerated for all providers.

## Verified
- `pnpm lint` → 0 errors.
- `pnpm test` → 1963 pass / 18 expected fail / 75 skip.
- `pnpm run build` → build complete.

## Install
```bash
npm install -g vansrouter
# or pull the image
docker pull ghcr.io/vanszs/vansrouter:0.8.0
```

# v0.7.8 (2026-06-30)

Hotfix for GHCR Docker installs. Users who ran `ghcr.io/vanszs/vansrouter:0.7.7` (or tried to create an API key in the dashboard) saw repeated `Error: API_KEY_SECRET environment variable is required` errors thrown from `src/shared/utils/apiKey.js:6`.

## Fixed
- `Dockerfile`: set `ENV API_KEY_SECRET=vansrouter-dev-default-change-me-in-production` so GHCR installs work out-of-the-box. Operators running production deployments should override with `-e API_KEY_SECRET="$(openssl rand -hex 32)"` at `docker run` time to invalidate any API keys minted with the default secret. Without this env var, the key generation path (`generateCrc` uses HMAC-SHA256 with the secret) throws and the keys POST handler returns 500.
- **Not a code bug** — the JS code is correct in throwing; the issue was a missing Dockerfile default. Pure configuration fix.
- **Client-abort loop bug** (`src/sse/handlers/chat.js`, `open-sse/handlers/chatCore.js`): when a client disconnected mid-request (or a coding-agent aborted), the account fallback loop in `handleSingleModelChat` kept cycling through accounts and re-hitting a dead upstream (e.g. CastAI returning HTTP 500), feeding the provider circuit breaker with probe requests that never recovered. The loop never checked `request.signal.aborted`, and `handleChatCore`'s `streamController` was not linked to the client's abort signal, so in-flight upstream fetches survived the disconnect. Now the fallback loop short-circuits with HTTP 499 as soon as the client aborts, and the client abort signal is forwarded to `streamController.abort()` to cancel pending upstream fetches.

## Verified
- `pnpm test` (full) → 1879 pass + 1 pre-existing flaky timing failure (`tests/unit/mark-account-unavailable-429.test.js` off-by-1ms in 90s cooldown — confirmed intermittent).
- `pnpm run build` → build complete (no-undef lint: clean).
- `pnpm lint:undef` → clean.
- `pnpm test tests/unit/circuit-breaker.test.js` → 15/15 pass.
- `pnpm test tests/unit/mark-account-unavailable-429.test.js` → 6/6 pass.

## Install
```bash
npm install -g vansrouter
# or pull the patched image
docker pull ghcr.io/vanszs/vansrouter:0.7.8
```

# v0.7.7 (2026-06-30)

Sync of upstream `decolua/9router` bug-fix batch onto the VansRouter fork, plus two repo-maintenance chores. No source-code regressions vs. v0.7.6.

## Fixed
- **translator**: preserve `cache_control` when `collapseTextParts` would otherwise drop it (`c0bd3e0d`).
- **translator**: map mid-conversation `system` message to `user` in the Claude response stream (`5f6f0b95`).
- **translator / responses**: handle `response.done` terminal events correctly (`b970c143`).
- **kiro**: replace missing `uuid` dep with `node:crypto.randomUUID()` (`89cb9763`).
- **kiro**: strip leaked `<thinking>` tags from the content stream (`e985f1e0`, #2158).
- **headroom**: translate `openai-responses` input through OpenAI before compression so non-OpenAI providers don't see Responses-only fields (`96411bb4`).
- **headroom**: skip unsafe Responses tool history (`e0512cf1`, #2132).
- **antigravity**: strip `deprecated`/`readOnly`/`writeOnly` from tool schemas before sending to Gemini (`26fd991b`, `4a80c16e`).
- **alicode**: preserve `cache_control` for DashScope providers (`199e3f67`, #2069).
- **kilocode**: expose full gateway catalog in the combo model picker (`30a69fa7`).
- **gemini**: backfill `thoughtSignature` and suppress `stream done sent` errors (`2d9294c2`).
- **gemini**: normalize `contents` to prevent `400 invalid_argument` from upstream (`bdaf57f1`, #2192).
- **OpenCode Go**: fix GLM routing (`a6a7bdbe`).
- **tray**: make Windows context menu DPI-aware so the icon renders crisp on high-DPI displays (`71329cc0`).
- **token-saver**: switch to full-width card layout (`31321e57`).
- **capabilities**: refine Qwen vision/video and thinking model patterns (`04c3e4a6`).

## Tests
- Update `tests/translator/__snapshots__/golden-url-header.test.js.snap` to the v0.7.6 snapshot (`8c3258ec`).
- New regression tests: `tests/unit/alicode-cache-control-2069.test.js`, `tests/unit/kiro-thinking-strip.test.js`, plus updates to `tests/unit/openai-responses-terminal-event.test.js`.

## Docs
- `AGENTS.md`: add a new **"Release Pipeline Rules (MANDATORY)"** section with three rules learned from the v0.7.5 → v0.7.6 cycle: (1) push merge to `origin/main` before pushing a release tag, otherwise `check-branch` sets `is-main=false` and the publish jobs are silently SKIPPED; (2) verify `npm`/`GHCR` artifacts immediately after pushing a tag — never trust the workflow's overall `success` conclusion alone; (3) never edit a source file with duplicate declarations of the same import (`runtime.js` once had `import { readFileSync, existsSync } from "node:fs"` twice and Next.js webpack rejected it).

## Chore
- Untrack `.kimchi/docs/lighthouse-reports/` (20 generated HTML/JSON files) from git. These are one-time lighthouse audit artifacts that were inflating the repo's HTML language percentage to 52.5%; now that `.kimchi/` and `.understand-anything/` are in `.gitignore`, the local copies remain on disk for reference but won't be re-committed.

## Verified
- `pnpm test tests/unit/runtime-detect.test.js` → 24/24 pass.
- `pnpm test` (full) → 1847 pass + 14 pre-existing `tests/unit/all-endpoints-robust.test.js` 401-Invalid-API-key failures (confirmed pre-existing on `main` before this release; not a regression).
- `pnpm run build` → build complete (no-undef lint: clean included).
- `pnpm lint:undef` → clean.

## Install
```bash
npm install -g vansrouter
```

# v0.7.6 (2026-06-30)

Hotfix release. v0.7.5 was published as a tag (a03d07d0 → fae6fa1c → 68e53b4e) but the auto-generated release workflow run (run 28419859527) failed at the webpack/parse stage of `next build` because `src/shared/utils/runtime.js` accidentally declared the same `import { readFileSync, existsSync } from "node:fs"` twice on lines 1 and 3. As a result neither the Docker image nor the npm package was published. This release removes the duplicate import and republishes with version 0.7.6.

## Fixed
- Remove the duplicate `import { readFileSync, existsSync } from "node:fs"` at the top of `src/shared/utils/runtime.js`. Without the fix, Next.js webpack rejects the module with `Module parse failed: Identifier 'readFileSync' has already been declared` and the entire release pipeline (GHCR image build + npm publish) fails.

## Verified
- `pnpm test tests/unit/runtime-detect.test.js` → 24/24 pass.
- `pnpm run build` → build complete (no-undef lint: clean included).
- `pnpm lint:undef` → clean.

## Install
```bash
npm install -g vansrouter
```

# v0.7.5 (2026-06-29)

Auto-update flow now detects the runtime (PM2, systemd, screen, tmux, Docker, or plain foreground) and offers a one-click Update & Restart button when a process manager is present. Running under PM2/systemd/screen/tmux, the npm install + restart happens in a detached child process spawned before exit, so the user no longer has to manually copy the command and re-run the binary.

## Added
- New helper `src/shared/utils/runtime.js` exporting `detectRuntime()` and `updateAndRestartCommand(runtime, pkg)`. Priority: pm2 > systemd > tmux > screen > docker > direct. Each runtime returns a tailored install+restart command; `direct` returns null so the original copy-and-restart UI stays in place.
- `/api/version/shutdown` reads an optional `{packageName, mode}` body. In `auto` mode (default) it spawns the detached install+restart child before exiting when the detected runtime supports it; otherwise it falls back to the original shutdown flow.
- `/api/version` response now includes `runtime`, `canAutoRestart`, and `installCommand` fields so the Sidebar can adapt its UI without hardcoding the package name.
- Sidebar UI shows the detected runtime (e.g. `Runtime: pm2 - auto-restart supported`) and renames the button to `Update & Restart` when auto-restart is available. The install-command copy target switches to the runtime-specific command.

## Fixed
- `GITHUB_RAW_PKG` was reading `main` but we push releases to `dev` (per user instruction not to push to main), so the Sidebar always reported `github_behind_npm` after a publish. Now points to `dev` so the comparison reflects what we actually released.

## Changed
- `README.md` + `cli/README.md` install commands corrected: Docker mount now points to `~/.9router:/app/data` (was `vansrouter-data:/home/node/.vansrouter`), port aligned with Dockerfile (`-p 20128:20128`), PM2 `--name vansrouter` (was `vansroute`), and a port-clarification note added.
- `donateUrl` cleared (was pointing to upstream `9router.com`). `DonateModal` now handles an empty donateUrl gracefully (`Donate is not configured.`).
- `.gitignore` now excludes `.kimchi/` and `.understand-anything/` so future tooling generations don't clutter the repo.
- `DonateModal` react-hooks `set-state-in-effect` regression fixed by wrapping synchronous `setFetchState` in `Promise.resolve().then()`.
- `tests/translator/__snapshots__/golden-url-header.test.js.snap` regenerated for the new `VansRouter/0.7.5` User-Agent, `vansrouter` `X-CLIENT-TYPE`/`X-Msh-Platform`, and `0.7.5` `X-CLIENT-VERSION`/`X-CORE-VERSION`.
- `.kimchi` (12M) and `.understand-anything` (5.3M) tooling artifacts committed to dev (one-time, before gitignore added).

## Tests
- New `tests/unit/runtime-detect.test.js`, 24 cases covering every runtime path (env-var-only, filesystem-only, combined) plus all `updateAndRestartCommand` outputs. Uses `vi.mock('node:fs')` so filesystem probes are deterministic on systemd test runners.
- `tests/translator/golden-url-header.test.js` snapshot regenerated.
- Confirmed `tests/unit/all-endpoints-robust.test.js` (14 failures returning 401 Invalid API key) also fails on `dev` before this release — pre-existing flaky tests with missing test API key setup, not a regression of this release.

## Install
```bash
npm install -g vansrouter
```

# v0.7.4 (2026-06-29)

Publish with a 2FA-bypass token (Classic Automation or Granular with bypass enabled). Earlier v0.7.3 publish attempt failed with EOTP because the token required an authenticator OTP; this release uses a bypass-2FA token issued from the package owner account (blugaaaaaaaa) so CI can publish without interactive 2FA.

## Changed
- Bump version to 0.7.4.
- No source changes since v0.7.3; this is a release-pipeline fix.

## Install
```bash
npm install -g vansrouter
```

# v0.7.3 (2026-06-29)

Publish npm package under the unscoped name `vansrouter`. The user owns `vansrouter` on npmjs.com via account `blugaaaaaaaa`; earlier attempts failed because the tokens in use were organization-scoped (`vanroute` org) instead of USER-scoped from the owner account.

## Changed
- Keep CLI npm package name as `vansrouter` (revert from scoped `@vanroute/vansrouter` experiment).
- Update version endpoint, updater config, sidebar messages, and CLI README install commands back to `vansrouter`.
- Bump version to `0.7.3` (v0.7.0/v0.7.1/v0.7.2 npm publish attempts failed with E404 due to org-scoped tokens).

## Install
```bash
npm install -g vansrouter
```

# v0.7.0 (2026-06-29)

First independent VansRouter release. Fork branding is now applied throughout the UI, CLI, documentation, and published artifacts while preserving the `~/.9router` data directory for backward compatibility.

## Infrastructure
- Unified release workflow (`.github/workflows/release.yml`) publishes both Docker images (GHCR + Docker Hub) and the `vansrouter` npm package on every `v*` tag push.
- Docker image: `ghcr.io/Vanszs/VansRouter:latest` and `vanszs/vansrouter:latest`.
- npm package: `vansrouter`.

## Branding
- Rename CLI npm package and UI labels from `9Router` to `VansRouter`.
- Update landing page, login page, CLI tray, terminal UI, and docs links to point to `github.com/Vanszs/VansRouter`.
- Update Docker / Compose docs to use VansRouter image while keeping host data path at `$HOME/.9router`.

## Notes
- Data directory remains `~/.9router` so existing users do not need to migrate.
- Internal provider/model IDs and autostart system identifiers are unchanged to avoid breaking existing configs.

# v0.5.12 (2026-06-26)

## Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v00.5.2 (2026-06-17)

## Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs forAntigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-06-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL

# v0.4.44 (2026-06-15)

## Features
- Add Blackbox provider with `bb` alias (#1143)
- Add Xiaomi token plan provider
- Enhance model select modal UX + modal traffic lights (#1111)
- Default Usage dashboard period to Today (#1141)

## Fixes
- Fix Cowork model selection and Windows CLI packaging (#1129)
- Update provider name retrieval for compatibility provider (#1135)
- Update JWT_SECRET handling

# v0.4.41 (2026-06-14)

## Features
- Add jcode CLI tool integration with auto-configuration (#1047)
- Redesign CLI Tools dashboard: grid layout (1/2/3 cols) + dedicated detail page per tool
- Add drag-and-drop reordering for combo models (#1108)
- Add Today period option to Usage & Analytics (#1063)
- Add DeepSeek V4 Pro effort aliases (#950)

## Fixes
- fix(autostart): work on nvm + npm 9/10, actually register with launchctl (#1104, fixes #1082)
- Fix Ollama usage not tracked/shown in UI (#1102)
- fix(opencode): preserve DeepSeek reasoning content (#1099, fixes #1093)
- Fix TUI input lag (replace enquirer with native readline, persistent raw mode)
- fix(ui): show API key row actions on mobile (#1112)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.39 (2026-06-14)

## Fixes
- fix(docker): restore `/app/server.js` (v0.4.38 regression)
