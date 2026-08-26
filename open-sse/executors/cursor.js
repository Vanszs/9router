import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import {
  generateCursorBody,
  encodeField,
  wrapConnectRPCFrame,
  decodeMessage,
  parseConnectRPCFrame,
  extractTextFromResponse,
  encodeMcpTools,
  decodeMcpArgs
} from "../utils/cursorProtobuf.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { estimateUsage } from "../utils/usageTracking.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { FORMATS } from "../translator/formats.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { fetchImageBytes, parseDataUri } from "../translator/concerns/image.js";
import { IMAGE_SIGNATURES } from "../config/mediaConfig.js";
import zlib from "zlib";
import crypto from "crypto";
import { cursorSessionManager } from "../services/cursorSessionManager.js";

// Detect cloud environment
const isCloudEnv = () => {
  if (typeof caches !== "undefined" && typeof caches === "object") return true;
  if (typeof EdgeRuntime !== "undefined") return true;
  return false;
};

// Lazy import http2 (only in Node.js environment)
let http2 = null;
if (!isCloudEnv()) {
  try {
    http2 = await import("http2");
  } catch {
    // http2 not available
  }
}

const COMPRESS_FLAG = {
  NONE: 0x00,
  GZIP: 0x01,
  TRAILER: 0x02,
  GZIP_TRAILER: 0x03
};

const AGENT_RUN_PATH = "/agent.v1.AgentService/Run";
const PROTOBUF_LEN = 2;
const PROTOBUF_VARINT = 0;

function concatBuffers(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const agentString = (field, value) => encodeField(field, PROTOBUF_LEN, value);
const agentMessage = (field, value) => encodeField(field, PROTOBUF_LEN, value);
const agentVarint = (field, value) => encodeField(field, PROTOBUF_VARINT, value);
const agentBool = (field, value) => encodeField(field, PROTOBUF_VARINT, value ? 1 : 0);
const MAX_CURSOR_IMAGES = 12;
const MAX_CURSOR_IMAGE_BYTES = 1024 * 1024;
const MAX_CURSOR_IMAGE_TOTAL_BYTES = 8 * 1024 * 1024;

function detectCursorImageMime(data) {
  for (const { sig, offset, mime, verifyWebp } of IMAGE_SIGNATURES) {
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime) || data.length < offset + sig.length) continue;
    if (!sig.every((byte, index) => data[offset + index] === byte)) continue;
    if (verifyWebp && Buffer.from(data.subarray(8, 12)).toString() !== "WEBP") continue;
    return mime;
  }
  return null;
}

function encodeSelectedImage(image, blobStore) {
  const blobId = crypto.createHash("sha256").update(image.data).digest();
  blobStore.set(blobId.toString("hex"), image.data);
  const ext = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1];
  const blobWithData = concatBuffers(agentMessage(1, blobId), agentMessage(2, image.data));
  return concatBuffers(
    agentString(2, image.uuid),
    agentString(3, `attachment-${image.uuid}.${ext}`),
    agentString(7, image.mimeType),
    agentMessage(9, blobWithData),
  );
}

async function resolveAgentImages(messages, signal) {
  const urls = messages
    .filter((message) => message?.role === "user" && Array.isArray(message.content))
    .flatMap((message) => message.content)
    .filter((part) => part?.type === "image_url")
    .map((part) => typeof part.image_url === "string" ? part.image_url : part.image_url?.url)
    .filter(Boolean);
  if (urls.length > MAX_CURSOR_IMAGES) throw new Error(`Cursor accepts at most ${MAX_CURSOR_IMAGES} images per request`);
  const images = [];
  let totalBytes = 0;
  for (const url of urls) {
    const remote = /^https?:\/\//i.test(url) ? await fetchImageBytes(url, { signal, maxBytes: MAX_CURSOR_IMAGE_BYTES }) : null;
    let data;
    let mimeType;
    if (remote) {
      data = remote.data;
      mimeType = remote.mimeType;
    } else {
      const parsed = parseDataUri(url);
      if (!parsed || /\s/.test(parsed.base64)) throw new Error("Cursor image must be a valid data URI or public HTTP(S) image");
      const estimatedBytes = Math.floor(parsed.base64.length * 3 / 4);
      if (estimatedBytes > MAX_CURSOR_IMAGE_BYTES) throw new Error("Cursor image exceeds 1 MiB");
      data = Buffer.from(parsed.base64, "base64");
      mimeType = detectCursorImageMime(data);
    }
    if (!mimeType || data.length === 0 || data.length > MAX_CURSOR_IMAGE_BYTES) throw new Error("Cursor image is invalid, unsupported, or exceeds 1 MiB");
    totalBytes += data.length;
    if (totalBytes > MAX_CURSOR_IMAGE_TOTAL_BYTES) throw new Error("Cursor images exceed the 8 MiB request limit");
    images.push({ data, mimeType, uuid: crypto.randomUUID() });
  }
  return images;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function isAgentCapableRequest(body) {
  return Array.isArray(body?.messages) && body.messages.every((message) => {
    if (message?.role === "tool") return true;
    if (message?.tool_calls !== undefined && !Array.isArray(message.tool_calls)) return false;
    return message?.content == null
      || typeof message.content === "string"
      || Array.isArray(message.content) && message.content.every((part) => part?.type === "text" || part?.type === "image_url");
  });
}

function serializeToolCall(call) {
  const name = call?.function?.name || "unknown_tool";
  const args = typeof call?.function?.arguments === "string"
    ? call.function.arguments
    : JSON.stringify(call?.function?.arguments ?? {});
  return `[assistant tool call ${call?.id || "unknown"}] ${name} ${args}`;
}
function flattenAgentMessages(messages) {
  return messages
    .filter((message) => message?.role !== "system")
    .flatMap((message) => {
      const lines = [];
      const content = textFromContent(message?.content);
      if (message?.role === "tool") {
        lines.push(`[tool result ${message.tool_call_id || "unknown"}] ${content || "(empty result)"}`);
      } else if (content) {
        lines.push(`[${message.role || "user"}] ${content}`);
      }
      for (const call of message?.tool_calls || []) lines.push(serializeToolCall(call));
      return lines;
    })
    .join("\n\n");
}

function selectAgentTools(tools, toolChoice) {
  if (toolChoice === "none") return [];
  const requiredName = toolChoice?.type === "function" && typeof toolChoice?.function?.name === "string"
    ? toolChoice.function.name
    : null;
  return requiredName ? tools.filter((tool) => (tool?.function?.name || tool?.name) === requiredName) : tools;
}

function toolDirective(toolChoice) {
  if (toolChoice === "required") return " You MUST call one of the provided tools before answering.";
  const name = toolChoice?.type === "function" ? toolChoice?.function?.name : null;
  return name ? ` You MUST call the ${name} tool before answering.` : "";
}

function encodeHistoryMessage(message) {
  const content = textFromContent(message?.content);
  if (!content) return null;

  // ConversationHistoryMessage.user / .assistant -> repeated content -> text.
  const text = agentString(1, content);
  if (message.role === "assistant") {
    return agentMessage(2, agentMessage(1, agentMessage(1, text)));
  }
  return agentMessage(1, agentMessage(1, agentMessage(1, text)));
}

export function buildAgentRunFrame(messages, model, tools = [], toolChoice = "auto", conversationId = crypto.randomUUID(), images = [], blobStore = new Map()) {
  const system = messages
    .filter((message) => message?.role === "system")
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .join("\n\n");
  const hasToolResult = messages.some((message) => message?.role === "tool");
  const hasToolHistory = hasToolResult || messages.some((message) => message?.tool_calls?.length);
  const chatMessages = messages.filter((message) => message?.role !== "system");
  const currentIndex = [...chatMessages].map((message) => message?.role).lastIndexOf("user");
  const current = currentIndex >= 0 ? chatMessages[currentIndex] : chatMessages.at(-1);
  const history = hasToolHistory ? [] : chatMessages
    .slice(0, currentIndex >= 0 ? currentIndex : -1)
    .map(encodeHistoryMessage)
    .filter(Boolean);
  const selectedTools = hasToolResult ? [] : selectAgentTools(tools, toolChoice);
  const toolPrompt = selectedTools.length
    ? `You are serving an OpenAI-compatible API with executable tools. When a tool is needed, issue the actual tool call instead of narrating intent.${toolDirective(toolChoice)}`
    : "";
  const userText = hasToolHistory
    ? `Continue this conversation using the tool results below. Do not call the completed tool again; answer from its result.\n\n${flattenAgentMessages(messages)}`
    : `${toolPrompt ? `${toolPrompt}\n\n` : ""}${textFromContent(current?.content) || "Continue."}`;

  const selectedImages = images.map((image) => agentMessage(1, encodeSelectedImage(image, blobStore)));
  const userMessage = concatBuffers(
    agentString(1, userText),
    agentString(2, crypto.randomUUID()),
    agentMessage(3, concatBuffers(...selectedImages)),
    agentVarint(4, 1),
  );
  const conversationHistory = history.length
    ? concatBuffers(...history.map((entry) => agentMessage(1, entry)))
    : null;
  const userAction = concatBuffers(
    agentMessage(1, userMessage),
    ...(conversationHistory ? [agentMessage(7, conversationHistory)] : []),
  );
  const conversationAction = agentMessage(1, userAction);
  const requestedModel = concatBuffers(agentString(1, model), agentBool(7, true));
  const runRequest = concatBuffers(
    agentMessage(1, new Uint8Array()),
    agentMessage(2, conversationAction),
    ...(system ? [agentString(8, system)] : []),
    ...(selectedTools.length ? [agentMessage(4, encodeMcpTools(selectedTools))] : []),
    agentString(5, conversationId),
    agentString(16, conversationId),
    agentMessage(9, requestedModel),
  );
  return wrapConnectRPCFrame(agentMessage(1, runRequest));
}

function fieldString(message, field) {
  const value = message?.get(field)?.[0]?.value;
  return value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : "";
}

function extractAgentString(message, field) {
  return fieldString(message, field);
}

function decodeAgentFrames(buffer, onFrame) {
  let pending = Buffer.from(buffer || []);
  while (pending.length >= 5) {
    const flags = pending[0];
    const length = pending.readUInt32BE(1);
    if (length > 16 * 1024 * 1024) throw new Error(`Cursor AgentService frame too large: ${length}`);
    if (pending.length < 5 + length) break;
    let payload = pending.subarray(5, 5 + length);
    pending = pending.subarray(5 + length);
    if (flags & COMPRESS_FLAG.GZIP) payload = zlib.gunzipSync(payload);
    if (!(flags & COMPRESS_FLAG.TRAILER)) onFrame(payload);
  }
  return pending;
}

function createRequestContextResponse(execMsgId = 0, execId = "") {
  const requestContextSuccess = agentMessage(1, new Uint8Array());
  const requestContextResult = agentMessage(1, requestContextSuccess);
  const execClientMessage = concatBuffers(
    agentVarint(1, execMsgId),
    ...(execId ? [agentString(15, execId)] : []),
    agentMessage(10, requestContextResult),
  );
  return wrapConnectRPCFrame(agentMessage(2, execClientMessage));
}

export function decodeCursorAgentExecEvent(serverMessage) {
  if (!serverMessage?.has(2)) return null;
  const exec = decodeMessage(serverMessage.get(2)[0].value);
  const execMsgId = Number(exec.get(1)?.[0]?.value || 0);
  const execId = fieldString(exec, 15);
  if (exec.has(10)) return { kind: "context", execMsgId, execId };
  if (exec.has(11)) {
    const decoded = decodeMcpArgs(exec.get(11)[0].value);
    return {
      kind: "mcp",
      execMsgId,
      execId,
      name: decoded.toolName || decoded.name,
      callId: decoded.toolCallId,
      args: decoded.args,
    };
  }
  const builtins = new Map([[2, "shell"], [7, "read"], [8, "list"], [14, "shell"]]);
  for (const [field, kind] of builtins) {
    if (!exec.has(field)) continue;
    const args = decodeMessage(exec.get(field)[0].value);
    return { kind: "builtin", builtin: kind, execMsgId, execId, value: fieldString(args, 1), cwd: fieldString(args, 2) };
  }
  return { kind: "unsupported", fields: [...exec.keys()] };
}

export function decodeCursorKvEvent(serverMessage) {
  if (!serverMessage?.has(4)) return null;
  const kv = decodeMessage(serverMessage.get(4)[0].value);
  const id = Number(kv.get(1)?.[0]?.value || 0);
  const metadata = kv.get(4)?.[0]?.value || null;
  if (kv.has(2)) {
    const args = decodeMessage(kv.get(2)[0].value);
    return { kind: "get", id, blobId: args.get(1)?.[0]?.value || new Uint8Array(), metadata };
  }
  if (kv.has(3)) {
    const args = decodeMessage(kv.get(3)[0].value);
    return {
      kind: "set",
      id,
      blobId: args.get(1)?.[0]?.value || new Uint8Array(),
      blobData: args.get(2)?.[0]?.value || new Uint8Array(),
      metadata,
    };
  }
  return null;
}

export function encodeCursorKvResult(event, blobData = new Uint8Array()) {
  const result = event.kind === "get"
    ? agentMessage(2, agentMessage(1, blobData))
    : agentMessage(3, new Uint8Array());
  const kvClient = concatBuffers(
    ...(event.id ? [agentVarint(1, event.id)] : []),
    result,
    ...(event.metadata?.length ? [agentMessage(4, event.metadata)] : []),
  );
  return wrapConnectRPCFrame(agentMessage(3, kvClient));
}

function bridgeBuiltin(event, tools) {
  const candidates = event.builtin === "read" ? ["read", "read_file"]
    : event.builtin === "list" ? ["glob", "list_files"]
    : ["bash", "shell", "run_terminal_cmd"];
  const tool = tools.find((candidate) => candidates.includes((candidate?.function?.name || candidate?.name || "").toLowerCase()));
  if (!tool || !event.value) return null;
  const name = tool?.function?.name || tool.name;
  const properties = tool?.function?.parameters?.properties || tool?.inputSchema?.properties || {};
  const keys = event.builtin === "read" ? ["filePath", "path", "file_path"]
    : event.builtin === "list" ? ["pattern", "path"] : ["command", "cmd"];
  const key = keys.find((candidate) => properties[candidate]);
  if (!key) return null;
  const args = { [key]: event.value };
  const cwdKey = ["workdir", "cwd", "workingDirectory", "working_directory"].find((candidate) => properties[candidate]);
  if (cwdKey && event.cwd) args[cwdKey] = event.cwd;
  return { name, args };
}

const CURSOR_STREAM_DEBUG = process.env.CURSOR_STREAM_DEBUG === "1";
const debugLog = (...args) => {
  if (CURSOR_STREAM_DEBUG) console.log(...args);
};

function isComposerModel(model) {
  const modelId = String(model || "").split("/").pop();
  return /^composer(?:-|$)/i.test(modelId);
}

function visibleComposerContentFromThinking(thinking) {
  if (!thinking) return "";
  const endTag = "</think>";
  const endIdx = thinking.lastIndexOf(endTag);
  if (endIdx < 0) return "";
  return thinking.slice(endIdx + endTag.length).trimStart();
}

function decompressPayload(payload, flags) {
  // Check if payload is JSON error (starts with {"error")
  if (payload.length > 10 && payload[0] === 0x7b && payload[1] === 0x22) {
    try {
      const text = payload.toString("utf-8");
      if (text.startsWith('{"error"')) {
        debugLog(`[DECOMPRESS] Detected JSON error, skipping decompression`);
        return payload;
      }
    } catch {}
  }

  if (
    flags === COMPRESS_FLAG.GZIP ||
    flags === COMPRESS_FLAG.TRAILER ||
    flags === COMPRESS_FLAG.GZIP_TRAILER
  ) {
    // Primary: try gzip decompression (standard gzip header 0x1f 0x8b)
    try {
      return zlib.gunzipSync(payload);
    } catch (gzipErr) {
      // Fallback: TRAILER and GZIP_TRAILER frames sometimes use raw zlib deflate format
      try {
        return zlib.inflateSync(payload);
      } catch (deflateErr) {
        // Last resort: try raw deflate (no zlib header)
        try {
          return zlib.inflateRawSync(payload);
        } catch (rawErr) {
          debugLog(
            `[DECOMPRESS ERROR] flags=${flags}, payloadSize=${payload.length}, gzip=${gzipErr.message}, deflate=${deflateErr.message}, raw=${rawErr.message}`
          );
          debugLog(
            `[DECOMPRESS ERROR] First 50 bytes (hex):`,
            payload.slice(0, 50).toString("hex")
          );
          return payload;
        }
      }
    }
  }
  return payload;
}

// Read one cursor protobuf frame: header + bounds + decompress. Returns status + payload + new offset.
function readCursorFrame(buffer, offset, frameNum, tag) {
  if (offset + 5 > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Reached end, offset=${offset}, remaining=${buffer.length - offset}`);
    return { status: "done" };
  }

  const flags = buffer[offset];
  const length = buffer.readUInt32BE(offset + 1);
  debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`);

  if (offset + 5 + length > buffer.length) {
    debugLog(`[CURSOR BUFFER${tag}] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`);
    return { status: "done" };
  }

  let payload = buffer.slice(offset + 5, offset + 5 + length);
  const newOffset = offset + 5 + length;
  payload = decompressPayload(payload, flags);
  if (!payload) {
    debugLog(`[CURSOR BUFFER${tag}] Frame ${frameNum + 1}: decompression failed, skipping`);
    return { status: "skip", offset: newOffset };
  }
  return { status: "ok", payload, offset: newOffset };
}

function createErrorResponse(jsonError) {
  const errorMsg = jsonError?.error?.details?.[0]?.debug?.details?.title
    || jsonError?.error?.details?.[0]?.debug?.details?.detail
    || jsonError?.error?.message
    || "API Error";
  
  const isRateLimit = jsonError?.error?.code === "resource_exhausted";
  
  return new Response(JSON.stringify({
    error: {
      message: errorMsg,
      type: isRateLimit ? "rate_limit_error" : "api_error",
      code: jsonError?.error?.details?.[0]?.debug?.error || "unknown"
    }
  }), {
    status: isRateLimit ? HTTP_STATUS.RATE_LIMITED : HTTP_STATUS.BAD_REQUEST,
    headers: { "Content-Type": "application/json" }
  });
}

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor);
  }

  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`;
  }

  buildHeaders(credentials) {
    const accessToken = credentials.accessToken;
    const machineId = credentials.providerSpecificData?.machineId;
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    return buildCursorHeaders(accessToken, machineId, ghostMode);
  }

  transformRequest(model, body, stream, credentials) {
    // Messages are already translated by chatCore (claude→openai→cursor)
    // Do NOT call openaiToCursorRequest again — double-translation drops tool_results
    const messages = body.messages || [];
    const tools = body.tools || [];
    const reasoningEffort = body.reasoning_effort || null;
    // Detect Claude Code UA to force Agent mode (issue #643)
    const ua = credentials?.rawHeaders?.["user-agent"] || "";
    const forceAgentMode = ua.includes("claude-cli") || ua.includes("claude-code") || ua.includes("Claude Code");
    return generateCursorBody(messages, model, tools, reasoningEffort, forceAgentMode);
  }

  async makeFetchRequest(url, headers, body, signal, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body,
      signal
    }, proxyOptions);

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer())
    };
  }

  makeHttp2Request(url, headers, body, signal) {
    if (!http2) {
      throw new Error("http2 module not available");
    }

    const HTTP2_TIMEOUT_MS = 60000; // 60s max — prevent hung sessions

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = http2.connect(`https://${urlObj.host}`);
      const chunks = [];
      let responseHeaders = {};
      let settled = false;

      // Ensure client is always closed on settle
      const finish = (fn) => (...args) => {
        if (settled) return;
        settled = true;
        clearTimeout(hangTimeout);
        client.close();
        fn(...args);
      };

      // Hard timeout: close session if server never responds
      const hangTimeout = setTimeout(finish(() => {
        reject(new Error("HTTP/2 request timed out"));
      }), HTTP2_TIMEOUT_MS);

      client.on("error", finish(reject));

      const req = client.request({
        ":method": "POST",
        ":path": urlObj.pathname,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers
      });

      req.on("response", (hdrs) => { responseHeaders = hdrs; });
      req.on("data", (chunk) => { chunks.push(chunk); });
      req.on("end", finish(() => {
        resolve({
          status: responseHeaders[":status"],
          headers: responseHeaders,
          body: Buffer.concat(chunks)
        });
      }));
      req.on("error", finish(reject));

      if (signal) {
        const onAbort = finish(() => reject(new Error("Request aborted")));
        signal.addEventListener("abort", onAbort, { once: true });
      }

      req.write(body);
      req.end();
    });
  }

  /**
   * AgentService (agent.api5.cursor.sh) is HTTP/2-only. Node's fetch/undici speaks
   * HTTP/1.1 and fails with HTTPParserError on the h2 preface — use http2 duplex.
   */
  openAgentHttp2Stream(url, headers) {
    if (!http2) {
      throw new Error("HTTP/2 is required for Cursor AgentService (endpoint is h2-only)");
    }

    const urlObj = new URL(url);
    const client = http2.connect(`https://${urlObj.host}`);
    const chunkQueue = [];
    let waiting = null;
    let ended = false;
    let streamError = null;
    let req = null;

    const wake = (result) => {
      if (!waiting) return;
      const resolve = waiting;
      waiting = null;
      resolve(result);
    };

    const fail = (error) => {
      if (streamError) return;
      streamError = error;
      ended = true;
      wake(null);
    };

    const close = () => {
      try { req?.destroy(); } catch {}
      try { client.close(); } catch {}
    };

    client.on("error", fail);

    req = client.request({
      ":method": "POST",
      ":path": urlObj.pathname,
      ":authority": urlObj.host,
      ":scheme": "https",
      ...headers,
    });

    req.on("error", fail);
    req.on("data", (chunk) => {
      if (waiting) wake({ value: chunk, done: false });
      else chunkQueue.push(chunk);
    });
    req.on("end", () => {
      ended = true;
      wake({ value: undefined, done: true });
    });

    // Caller cancellation is managed by executeAgent. Retained streams must
    // outlive the HTTP request that surfaced their tool call.

    const responseHeaders = new Promise((resolve, reject) => {
      const onEarlyError = (error) => reject(error);
      client.once("error", onEarlyError);
      req.once("error", onEarlyError);
      req.once("response", (hdrs) => {
        client.off("error", onEarlyError);
        req.off("error", onEarlyError);
        resolve(hdrs);
      });
    });

    return {
      responseHeaders,
      write(frame) {
        if (req && !req.destroyed) req.write(Buffer.from(frame));
      },
      end() {
        try { if (req && !req.destroyed) req.end(); } catch {}
      },
      close,
      async read() {
        if (chunkQueue.length) return { value: chunkQueue.shift(), done: false };
        if (ended) {
          if (streamError) throw streamError;
          return { value: undefined, done: true };
        }
        const result = await new Promise((resolve) => { waiting = resolve; });
        if (streamError) throw streamError;
        return result || { value: undefined, done: true };
      },
    };
  }

  async executeAgent({ model, body, stream, credentials, signal }) {
    const agentEndpoint = PROVIDER_OAUTH.cursor?.agentEndpoint;
    if (!agentEndpoint) throw new Error("Cursor AgentService endpoint is not configured");

    const url = `${agentEndpoint}${AGENT_RUN_PATH}`;
    const headers = this.buildHeaders(credentials);
    const requestController = new AbortController();
    let cacheOwnsTransport = false;
    let cacheEntry;
    const onRequestAbort = () => {
      requestController.abort(signal?.reason);
      if (!cacheOwnsTransport && cacheEntry) cursorSessionManager.close(cacheEntry);
    };
    if (signal?.addEventListener) signal.addEventListener("abort", onRequestAbort, { once: true });

    const messages = body.messages || [];
    const conversationId = typeof body.conversation_id === "string" && body.conversation_id
      ? body.conversation_id
      : crypto.randomUUID();
    const toolResultIds = messages.filter((message) => message?.role === "tool" && message.tool_call_id).map((message) => message.tool_call_id);
    let cachedSession = toolResultIds.length ? cursorSessionManager.acquire(conversationId) : undefined;
    if (!cachedSession && toolResultIds.length && !body.conversation_id) cachedSession = cursorSessionManager.findByToolCallIds(toolResultIds);
    let transport = cachedSession?.transport;
    cacheEntry = cachedSession;

    if (cachedSession) {
      let matched = 0;
      for (const message of messages) {
        if (message?.role !== "tool" || !cachedSession.pendingToolCalls.has(message.tool_call_id)) continue;
        const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
        if (cursorSessionManager.sendToolResult(cachedSession, message.tool_call_id, content, false)) matched++;
      }
      if (!matched) {
        cursorSessionManager.close(cachedSession);
        cachedSession = undefined;
        cacheEntry = undefined;
        transport = undefined;
      }
    }

    if (!transport) {
      try {
        const blobStore = new Map();
        const images = await resolveAgentImages(messages, requestController.signal);
        transport = this.openAgentHttp2Stream(url, headers);
        transport.write(buildAgentRunFrame(messages, model, body.tools || [], body.tool_choice, conversationId, images, blobStore));
        cacheEntry = cursorSessionManager.open(conversationId, transport, blobStore);
      } catch (error) {
        throw new Error(`Cursor AgentService request failed: ${error.message}`);
      }

      let responseHeaders;
      try {
        responseHeaders = await transport.responseHeaders;
      } catch (error) {
        cursorSessionManager.close(cacheEntry);
        throw new Error(`Cursor AgentService request failed: ${error.message}`);
      }

      const status = Number(responseHeaders[":status"] || 0);
      if (status !== 200) {
        let errorText = "";
        try {
          while (true) {
            const { done, value } = await transport.read();
            if (done) break;
            errorText += Buffer.from(value).toString("utf8");
          }
        } catch {}
        cursorSessionManager.close(cacheEntry);
        return {
          response: new Response(JSON.stringify({ error: { message: `Cursor AgentService ${status}: ${errorText || "request failed"}`, type: "api_error" } }), { status: status || HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
          url, headers, transformedBody: body, responseFormat: FORMATS.OPENAI,
        };
      }
    }


    // The Claude SSE translator derives Anthropic's message ID by stripping
    // `chatcmpl-`. Keep the remaining ID in Anthropic's required `msg_` form
    // so strict clients such as Claude Code accept the completed stream.
    const responseId = `chatcmpl-msg_${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let pending = Buffer.alloc(0);
    let finished = false;
    let retainSession = false;

    const selectedTools = selectAgentTools(body.tools || [], body.tool_choice);
    const consume = async (onEvent) => {
      let emitted = false;
      const emit = (event) => {
        emitted = true;
        onEvent(event);
      };
      try {
        while (!finished) {
          const { done, value } = await transport.read();
          if (done) break;
          pending = Buffer.concat([pending, Buffer.from(value)]);
          pending = decodeAgentFrames(pending, (payload) => {
            if (finished) return;
            const serverMessage = decodeMessage(payload);
            const kvEvent = decodeCursorKvEvent(serverMessage);
            if (kvEvent?.kind === "get") {
              const blob = cacheEntry.blobStore.get(Buffer.from(kvEvent.blobId).toString("hex")) || new Uint8Array();
              transport.write(encodeCursorKvResult(kvEvent, blob));
            } else if (kvEvent?.kind === "set") {
              const key = Buffer.from(kvEvent.blobId).toString("hex");
              if (key && kvEvent.blobData.length <= 8 * 1024 * 1024) {
                cursorSessionManager.storeBlob(cacheEntry, key, kvEvent.blobData);
              }
              transport.write(encodeCursorKvResult(kvEvent));
            }
            if (serverMessage.has(1)) {
              const update = decodeMessage(serverMessage.get(1)[0].value);
              if (update.has(1)) {
                const textDelta = extractAgentString(decodeMessage(update.get(1)[0].value), 1);
                if (textDelta) emit({ type: "text", value: textDelta });
              }
              if (update.has(14)) {
                finished = true;
                emit({ type: "done" });
              }
            }

            const execEvent = decodeCursorAgentExecEvent(serverMessage);
            if (execEvent?.kind === "context") {
              transport.write(createRequestContextResponse(execEvent.execMsgId, execEvent.execId));
            } else if (execEvent?.kind === "mcp") {
              if (!execEvent.name) {
                finished = true;
                emit({ type: "error", value: "Cursor AgentService returned a tool call without a name" });
                emit({ type: "done" });
                return;
              }
              const callId = `call_${crypto.randomUUID().replaceAll("-", "")}`;
              cursorSessionManager.registerToolCall(cacheEntry, callId, {
                execMsgId: execEvent.execMsgId,
                execId: execEvent.execId,
                toolName: execEvent.name,
              });
              finished = true;
              emit({
                type: "tool_call",
                value: {
                  id: callId,
                  type: "function",
                  function: { name: execEvent.name, arguments: JSON.stringify(execEvent.args || {}) },
                },
              });
              emit({ type: "done" });
            } else if (execEvent?.kind === "builtin") {
              const bridged = bridgeBuiltin(execEvent, selectedTools);
              if (bridged) {
                const callId = `call_${crypto.randomUUID().replaceAll("-", "")}`;
                retainSession = true;
                cursorSessionManager.registerToolCall(cacheEntry, callId, {
                  execMsgId: execEvent.execMsgId,
                  execId: execEvent.execId,
                  toolName: bridged.name,
                });
                finished = true;
                emit({
                  type: "tool_call",
                  value: {
                    id: callId,
                    type: "function",
                    function: { name: bridged.name, arguments: JSON.stringify(bridged.args) },
                  },
                });
                emit({ type: "done" });
              } else {
                finished = true;
                emit({ type: "error", value: `Cursor requested unsupported built-in ${execEvent.builtin}` });
                emit({ type: "done" });
              }
            } else if (execEvent?.kind === "unsupported") {
              debugLog(`[CURSOR AGENT] Unsupported exec request fields: ${execEvent.fields.join(",")}`);
              finished = true;
              emit({ type: "error", value: "Cursor AgentService requested an unsupported IDE tool" });
              emit({ type: "done" });
            }
          });
        }
      } finally {
        if (retainSession && !requestController.signal.aborted) {
          cacheOwnsTransport = true;
          cursorSessionManager.release(cacheEntry);
        } else {
          cursorSessionManager.close(cacheEntry);
        }
        if (signal?.removeEventListener) signal.removeEventListener("abort", onRequestAbort);
        if (!finished) {
          if (!emitted) onEvent({ type: "error", value: "Cursor AgentService ended without content or tool calls" });
          onEvent({ type: "done" });
        }
      }
    };

    if (stream === false) {
      let content = "";
      let agentError = null;
      const toolCalls = [];
      await consume((event) => {
        if (event.type === "text") content += event.value;
        else if (event.type === "tool_call") toolCalls.push(event.value);
        else if (event.type === "error") agentError = event.value;
      });
      if (agentError && !content && toolCalls.length === 0) {
        return {
          response: new Response(JSON.stringify({ error: { message: agentError, type: "api_error" } }), {
            status: HTTP_STATUS.BAD_GATEWAY,
            headers: { "Content-Type": "application/json" },
          }),
          url,
          headers,
          transformedBody: body,
          responseFormat: FORMATS.OPENAI,
        };
      }
      const message = { role: "assistant", content: content || null };
      if (toolCalls.length) message.tool_calls = toolCalls;
      return {
        response: new Response(JSON.stringify({
          id: responseId,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
          usage: estimateUsage(body, content.length, FORMATS.OPENAI),
        }), { headers: { "Content-Type": "application/json" } }),
        url,
        headers,
        transformedBody: body,
        responseFormat: FORMATS.OPENAI,
      };
    }

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      start(controller) {
        let roleEmitted = false;
        let hasToolCalls = false;
        let closed = false;
        const enqueue = (chunk) => { if (!closed) controller.enqueue(encoder.encode(chunk)); };
        consume((event) => {
          if (closed) return;
          if (event.type === "text") {
            enqueue(chatChunkSse({ id: responseId, created, model, delta: roleEmitted ? { content: event.value } : { role: "assistant", content: event.value } }));
            roleEmitted = true;
          } else if (event.type === "tool_call") {
            if (!roleEmitted) {
              enqueue(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
              roleEmitted = true;
            }
            hasToolCalls = true;
            enqueue(chatChunkSse({ id: responseId, created, model, delta: { tool_calls: [{ index: 0, ...event.value }] } }));
          } else if (event.type === "error") {
            enqueue(sseChunk({ error: { message: event.value, type: "api_error" } }));
          } else if (event.type === "done") {
            enqueue(chatChunkSse({ id: responseId, created, model, delta: {}, finishReason: hasToolCalls ? "tool_calls" : "stop" }));
            enqueue(SSE_DONE);
            closed = true;
            controller.close();
          }
        }).catch((error) => { if (!closed) controller.error(error); });
      },
      cancel() {
        onRequestAbort();
      },
    });

    return {
      response: new Response(responseStream, { headers: SSE_HEADERS }),
      url,
      headers,
      transformedBody: body,
      responseFormat: FORMATS.OPENAI,
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    if (isAgentCapableRequest(body)) {
      try {
        return await this.executeAgent({ model, body, stream, credentials, signal });
      } catch (error) {
        return {
          response: new Response(JSON.stringify({
            error: { message: error.message, type: "connection_error", code: "" },
          }), { status: HTTP_STATUS.SERVER_ERROR, headers: { "Content-Type": "application/json" } }),
          url: `${PROVIDER_OAUTH.cursor?.agentEndpoint || ""}${AGENT_RUN_PATH}`,
          headers: {},
          transformedBody: body,
          responseFormat: FORMATS.OPENAI,
        };
      }
    }

    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    try {
      const shouldForceFetch = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true || !!proxyOptions?.vercelRelayUrl;
      const response = (http2 && !shouldForceFetch)
        ? await this.makeHttp2Request(url, headers, transformedBody, signal)
        : await this.makeFetchRequest(url, headers, transformedBody, signal, proxyOptions);

      if (response.status !== 200) {
        const errorText = response.body?.toString() || "Unknown error";
        const errorResponse = new Response(JSON.stringify({
          error: {
            message: `[${response.status}]: ${errorText}`,
            type: "invalid_request_error",
            code: ""
          }
        }), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
        return { response: errorResponse, url, headers, transformedBody: body };
      }

      const transformedResponse = stream !== false
        ? this.transformProtobufToSSE(response.body, model, body)
        : this.transformProtobufToJSON(response.body, model, body);

      return { response: transformedResponse, url, headers, transformedBody: body };
    } catch (error) {
      const errorResponse = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "connection_error",
          code: ""
        }
      }), {
        status: HTTP_STATUS.SERVER_ERROR,
        headers: { "Content-Type": "application/json" }
      });
      return { response: errorResponse, url, headers, transformedBody: body };
    }
  }

  transformProtobufToJSON(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    const toolCalls = [];
    const toolCallsMap = new Map(); // Track streaming tool calls by ID
    const finalizedIds = new Set();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, "");
      if (frame.status === "done") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload;

      // Check for JSON error frames (byte guard: skip toString on non-JSON frames)
      if (payload.length > 0 && payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;
        } else {
          // New tool call
          toolCallsMap.set(tc.id, { ...tc });
        }

        // Push to final array when isLast is true
        if (tc.isLast) {
          const finalToolCall = toolCallsMap.get(tc.id);
          finalizedIds.add(tc.id);
          toolCalls.push({
            id: finalToolCall.id,
            type: finalToolCall.type,
            function: {
              name: finalToolCall.function.name,
              arguments: finalToolCall.function.arguments
            }
          });
        }
      }

      if (result.text) totalContent += result.text;
      if (result.thinking) totalThinking += result.thinking;
    }

    const visibleComposerContent = isComposerModel(model)
      ? visibleComposerContentFromThinking(totalThinking)
      : "";
    const finalContent = totalContent || visibleComposerContent;

    debugLog(
      `[CURSOR BUFFER] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, finalized toolCalls: ${toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (in case stream ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      // Check if already in final array
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });
      }
    }

    debugLog(`[CURSOR BUFFER] Final toolCalls count: ${toolCalls.length}`);


    const message = {
      role: "assistant",
      content: finalContent || null
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    const usage = estimateUsage(body, finalContent.length, FORMATS.OPENAI);

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
      }],
      usage
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  transformProtobufToSSE(buffer, model, body) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const chunks = [];
    let offset = 0;
    let totalContent = "";
    let totalThinking = "";
    let emittedComposerThinkingContentLength = 0;
    const toolCalls = [];
    const toolCallsMap = new Map(); // Track streaming tool calls by ID
    const finalizedIds = new Set();
    const emittedToolCallIds = new Set();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER SSE] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      const frame = readCursorFrame(buffer, offset, frameCount, " SSE");
      if (frame.status === "done") break;
      offset = frame.offset;
      frameCount++;
      if (frame.status === "skip") continue;
      const payload = frame.payload;

      // Check for JSON error frames (byte-guard: only decode if starts with '{')
      if (payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER SSE] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {}
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED SSE] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER SSE] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited"
            }
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (chunks.length === 0) {
          chunks.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
        }

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          const oldArgsLen = existing.function.arguments.length;
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;

          // Stream the delta arguments
          if (tc.function.arguments) {
            emittedToolCallIds.add(tc.id);
            chunks.push(chatChunkSse({
              id: responseId, created, model,
              delta: {
                tool_calls: [
                  {
                    index: existing.index,
                    id: tc.id,
                    type: "function",
                    function: {
                      name: tc.function.name,
                      arguments: tc.function.arguments
                    }
                  }
                ]
              }
            }));
          }
        } else {
          // New tool call - assign index and add to map
          const toolCallIndex = toolCalls.length;
          finalizedIds.add(tc.id);
          toolCalls.push({ ...tc, index: toolCallIndex });
          toolCallsMap.set(tc.id, { ...tc, index: toolCallIndex });

          // Stream initial tool call with name
          emittedToolCallIds.add(tc.id);
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }
              ]
            }
          }));
        }
      }

      if (result.text) {
        totalContent += result.text;
        chunks.push(chatChunkSse({
          id: responseId, created, model,
          delta:
            chunks.length === 0 && toolCalls.length === 0
              ? { role: "assistant", content: result.text }
              : { content: result.text }
        }));
      }

      if (isComposerModel(model) && result.thinking) {
        totalThinking += result.thinking;
        const visibleContent = visibleComposerContentFromThinking(totalThinking);
        if (visibleContent.length > emittedComposerThinkingContentLength) {
          const deltaContent = visibleContent.slice(emittedComposerThinkingContentLength);
          emittedComposerThinkingContentLength = visibleContent.length;
          totalContent += deltaContent;
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta:
              chunks.length === 0 && toolCalls.length === 0
                ? { role: "assistant", content: deltaContent }
                : { content: deltaContent }
          }));
        }
      }
    }

    debugLog(
      `[CURSOR BUFFER SSE] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, toolCalls array: ${toolCalls.length}`
    );

    // Finalize all remaining tool calls in map (stream may have ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER SSE] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        const toolCallIndex = toolCalls.length;
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          index: toolCallIndex,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        });

        // Emit SSE chunk for the finalized tool call if not already emitted
        if (!emittedToolCallIds.has(tc.id)) {
          chunks.push(chatChunkSse({
            id: responseId, created, model,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                  }
                }
              ]
            }
          }));
        }
      }
    }

    if (chunks.length === 0 && toolCalls.length === 0) {
      chunks.push(chatChunkSse({ id: responseId, created, model, delta: { role: "assistant", content: "" } }));
    }

    const usage = estimateUsage(body, totalContent.length, FORMATS.OPENAI);

    chunks.push(
      `data: ${JSON.stringify({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
          }
        ],
        usage
      })}\n\n`
    );
    chunks.push(SSE_DONE);

    return new Response(chunks.join(""), {
      status: 200,
      headers: { ...SSE_HEADERS }
    });
  }

  async refreshCredentials() {
    return null;
  }
}

export default CursorExecutor;
