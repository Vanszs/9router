import { encodeMcpResultSuccess } from "../utils/cursorAgentProtobuf.js";
import { encodeField, wrapConnectRPCFrame } from "../utils/cursorProtobuf.js";

const LEN = 2;
const VARINT = 0;
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SESSION_BLOB_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_GLOBAL_BLOB_BYTES = 128 * 1024 * 1024;
const MAX_TOOL_RESULT_BYTES = 2 * 1024 * 1024;

function concat(...parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

export function encodeExecMcpResult(execMsgId, execId, content, isError = false) {
  const success = encodeMcpResultSuccess({ textItems: [content], isError });
  const execClientMessage = concat(
    encodeField(1, VARINT, execMsgId),
    encodeField(15, LEN, execId || ""),
    encodeField(11, LEN, success),
  );
  return wrapConnectRPCFrame(encodeField(2, LEN, execClientMessage));
}

export class CursorSessionManager {
  constructor({
    idleTtlMs = DEFAULT_IDLE_TTL_MS,
    maxSessions = 100,
    maxSessionBlobBytes = DEFAULT_MAX_SESSION_BLOB_BYTES,
    maxGlobalBlobBytes = DEFAULT_MAX_GLOBAL_BLOB_BYTES,
  } = {}) {
    this.idleTtlMs = idleTtlMs;
    this.maxSessions = maxSessions;
    this.maxSessionBlobBytes = maxSessionBlobBytes;
    this.maxGlobalBlobBytes = maxGlobalBlobBytes;
    this.globalBlobBytes = 0;
    this.sessions = new Map();
    this.toolCallSessions = new Map();
  }

  open(conversationId, transport, blobStore = new Map()) {
    const existing = this.sessions.get(conversationId);
    if (existing) this.close(existing);
    const session = { conversationId, transport, blobStore: new Map(), blobBytes: 0, pendingToolCalls: new Map(), state: "running", lastActivityTs: Date.now(), idleTimer: null };
    this.sessions.set(conversationId, session);
    for (const [key, data] of blobStore) {
      if (!this.storeBlob(session, key, data)) {
        this.close(session);
        throw new Error("Cursor session blobs exceed memory limits");
      }
    }
    this.enforceLimit();
    return session;
  }

  acquire(conversationId) {
    this.evictExpired();
    const session = this.sessions.get(conversationId);
    if (!session || session.state !== "awaiting_tool_result") return undefined;
    this.clearTimer(session);
    session.state = "running";
    session.lastActivityTs = Date.now();
    return session;
  }

  findByToolCallIds(ids) {
    this.evictExpired();
    for (const id of ids) {
      const session = this.toolCallSessions.get(id);
      if (!session || session.state !== "awaiting_tool_result" || !session.pendingToolCalls.has(id)) continue;
      this.clearTimer(session);
      session.state = "running";
      session.lastActivityTs = Date.now();
      return session;
    }
    return undefined;
  }

  registerToolCall(session, toolCallId, pending) {
    session.pendingToolCalls.set(toolCallId, pending);
    this.toolCallSessions.set(toolCallId, session);
  }
  storeBlob(session, key, data) {
    const value = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const previous = session.blobStore.get(key);
    const delta = value.length - (previous?.length || 0);
    if (value.length > this.maxSessionBlobBytes || session.blobBytes + delta > this.maxSessionBlobBytes) return false;
    while (this.globalBlobBytes + delta > this.maxGlobalBlobBytes) {
      const oldest = this.oldestSession(session);
      if (!oldest) return false;
      this.close(oldest);
    }
    session.blobStore.set(key, value);
    session.blobBytes += delta;
    this.globalBlobBytes += delta;
    return true;
  }


  sendToolResult(session, toolCallId, content, isError = false) {
    const pending = session.pendingToolCalls.get(toolCallId);
    if (!pending) return false;
    if (Buffer.byteLength(content, "utf8") > MAX_TOOL_RESULT_BYTES) {
      throw new Error("Cursor tool result exceeds the 2 MiB limit");
    }
    try {
      session.transport.write(encodeExecMcpResult(pending.execMsgId, pending.execId, content, isError));
      session.pendingToolCalls.delete(toolCallId);
      this.toolCallSessions.delete(toolCallId);
      session.lastActivityTs = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  release(session) {
    session.state = "awaiting_tool_result";
    session.lastActivityTs = Date.now();
    this.clearTimer(session);
    session.idleTimer = setTimeout(() => this.close(session), this.idleTtlMs);
    session.idleTimer.unref?.();
  }

  close(session) {
    if (!session || session.state === "closed") return;
    session.state = "closed";
    this.clearTimer(session);
    for (const toolCallId of session.pendingToolCalls.keys()) this.toolCallSessions.delete(toolCallId);
    session.pendingToolCalls.clear();
    this.globalBlobBytes = Math.max(0, this.globalBlobBytes - session.blobBytes);
    session.blobBytes = 0;
    session.blobStore.clear();
    this.sessions.delete(session.conversationId);
    session.transport.close();
  }

  clearTimer(session) {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }

  evictExpired() {
    const cutoff = Date.now() - this.idleTtlMs;
    for (const session of this.sessions.values()) if (session.lastActivityTs < cutoff) this.close(session);
  }

  oldestSession(exclude) {
    let oldest;
    for (const session of this.sessions.values()) {
      if (session === exclude || oldest && session.lastActivityTs >= oldest.lastActivityTs) continue;
      oldest = session;
    }
    return oldest;
  }

  enforceLimit() {
    while (this.sessions.size > this.maxSessions) this.close(this.oldestSession());
  }

  size() { return this.sessions.size; }
  has(id) { return this.sessions.has(id); }
  blobBytes() { return this.globalBlobBytes; }
}

export const cursorSessionManager = new CursorSessionManager();
