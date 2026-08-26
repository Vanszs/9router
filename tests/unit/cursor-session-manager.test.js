import { describe, expect, it } from "vitest";
import { CursorSessionManager } from "../../open-sse/services/cursorSessionManager.js";

function mockTransport() {
  const writes = [];
  let closed = false;
  return {
    transport: { write: (data) => writes.push(Buffer.from(data)), close: () => { closed = true; } },
    writes,
    isClosed: () => closed,
  };
}

describe("CursorSessionManager", () => {
  it("retains, reacquires, and consumes a pending tool result", () => {
    const manager = new CursorSessionManager();
    const mock = mockTransport();
    const session = manager.open("conv-1", mock.transport, new Map());
    manager.registerToolCall(session, "call-1", { execMsgId: 9, execId: "exec-1", toolName: "probe" });
    manager.release(session);
    expect(manager.acquire("conv-1")).toBe(session);
    expect(manager.sendToolResult(session, "call-1", "cached result")).toBe(true);
    expect(mock.writes).toHaveLength(1);
    expect(mock.writes[0].includes(Buffer.from("exec-1"))).toBe(true);
    expect(mock.writes[0].includes(Buffer.from("cached result"))).toBe(true);
  });

  it("consumes multiple pending tool results on one retained stream", () => {
    const manager = new CursorSessionManager();
    const mock = mockTransport();
    const session = manager.open("conv-parallel", mock.transport);
    manager.registerToolCall(session, "call-a", { execMsgId: 1, execId: "exec-a", toolName: "a" });
    manager.registerToolCall(session, "call-b", { execMsgId: 2, execId: "exec-b", toolName: "b" });
    expect(manager.sendToolResult(session, "call-a", "one")).toBe(true);
    expect(manager.sendToolResult(session, "call-b", "two")).toBe(true);
    expect(mock.writes).toHaveLength(2);
    expect(session.pendingToolCalls.size).toBe(0);
  });

  it("rejects oversized tool results before writing", () => {
    const manager = new CursorSessionManager();
    const mock = mockTransport();
    const session = manager.open("conv-large-result", mock.transport);
    manager.registerToolCall(session, "call-large", { execMsgId: 1, execId: "exec", toolName: "tool" });
    expect(() => manager.sendToolResult(session, "call-large", "x".repeat(2 * 1024 * 1024 + 1))).toThrow(/2 MiB/);
    expect(mock.writes).toHaveLength(0);
  });

  it("finds OpenAI clients without conversation_id by tool call ID", () => {
    const manager = new CursorSessionManager();
    const session = manager.open("generated", mockTransport().transport, new Map());
    manager.registerToolCall(session, "call-match", { execMsgId: 1, execId: "e", toolName: "probe" });
    manager.release(session);
    expect(manager.findByToolCallIds(["call-match"])).toBe(session);
    expect(manager.sendToolResult(session, "call-match", "done")).toBe(true);
    manager.release(session);
    expect(manager.findByToolCallIds(["call-match"])).toBeUndefined();
  });

  it("evicts retained streams after TTL", async () => {
    const manager = new CursorSessionManager({ idleTtlMs: 10 });
    const mock = mockTransport();
    const session = manager.open("conv-ttl", mock.transport, new Map([["blob", Buffer.from("data")]]));
    manager.release(session);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.size()).toBe(0);
    expect(mock.isClosed()).toBe(true);
    expect(session.blobStore.size).toBe(0);
  });

  it("bounds retained session count", () => {
    const manager = new CursorSessionManager({ maxSessions: 1 });
    const first = mockTransport();
    manager.open("first", first.transport);
    manager.open("second", mockTransport().transport);
    expect(manager.has("first")).toBe(false);
    expect(manager.has("second")).toBe(true);
    expect(first.isClosed()).toBe(true);
  });

  it("enforces per-session and global blob byte budgets", () => {
    const manager = new CursorSessionManager({ maxSessionBlobBytes: 8, maxGlobalBlobBytes: 10 });
    const first = manager.open("blob-1", mockTransport().transport, new Map([["a", Buffer.alloc(6)]]));
    expect(manager.storeBlob(first, "b", Buffer.alloc(3))).toBe(false);
    const firstTransport = first.transport;
    const second = manager.open("blob-2", mockTransport().transport, new Map([["c", Buffer.alloc(6)]]));
    expect(manager.has("blob-1")).toBe(false);
    expect(manager.has("blob-2")).toBe(true);
    expect(manager.blobBytes()).toBe(6);
    expect(firstTransport).toBeTruthy();
    manager.close(second);
    expect(manager.blobBytes()).toBe(0);
  });
});
