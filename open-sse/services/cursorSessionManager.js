import { encodeMcpResultSuccess } from "../utils/cursorAgentProtobuf.js";
import { encodeField, wrapConnectRPCFrame } from "../utils/cursorProtobuf.js";

const LEN = 2;
const VARINT = 0;
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000;

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
  constructor({ idleTtlMs = DEFAULT_IDLE_TTL_MS, maxSessions = 100 } = {}) {
    this.idleTtlMs = idleTtlMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
  }

  open(conversationId, transport, blobStore = new Map()) {
    const existing = this.sessions.get(conversationId);
    if (existing) this.close(existing);
    const session = { conversationId, transport, blobStore, pendingToolCalls: new Map(), state: "running", lastActivityTs: Date.now(), idleTimer: null };
    this.sessions.set(conversationId, session);
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
      for (const session of this.sessions.values()) {
        if (session.state !== "awaiting_tool_result" || !session.pendingToolCalls.has(id)) continue;
        this.clearTimer(session);
        session.state = "running";
        session.lastActivityTs = Date.now();
        return session;
      }
    }
    return undefined;
  }

  sendToolResult(session, toolCallId, content, isError = false) {
    const pending = session.pendingToolCalls.get(toolCallId);
    if (!pending) return false;
    try {
      session.transport.write(encodeExecMcpResult(pending.execMsgId, pending.execId, content, isError));
      session.pendingToolCalls.delete(toolCallId);
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
    session.pendingToolCalls.clear();
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

  enforceLimit() {
    while (this.sessions.size > this.maxSessions) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastActivityTs - b.lastActivityTs)[0];
      this.close(oldest);
    }
  }

  size() { return this.sessions.size; }
  has(id) { return this.sessions.has(id); }
}

export const cursorSessionManager = new CursorSessionManager();
