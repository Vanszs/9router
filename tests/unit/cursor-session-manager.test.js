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
    session.pendingToolCalls.set("call-1", { execMsgId: 9, execId: "exec-1", toolName: "probe" });
    manager.release(session);
    expect(manager.acquire("conv-1")).toBe(session);
    expect(manager.sendToolResult(session, "call-1", "cached result")).toBe(true);
    expect(mock.writes).toHaveLength(1);
    expect(mock.writes[0].includes(Buffer.from("exec-1"))).toBe(true);
    expect(mock.writes[0].includes(Buffer.from("cached result"))).toBe(true);
  });

  it("finds OpenAI clients without conversation_id by tool call ID", () => {
    const manager = new CursorSessionManager();
    const session = manager.open("generated", mockTransport().transport, new Map());
    session.pendingToolCalls.set("call-match", { execMsgId: 1, execId: "e", toolName: "probe" });
    manager.release(session);
    expect(manager.findByToolCallIds(["call-match"])).toBe(session);
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
});
