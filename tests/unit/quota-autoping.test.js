// #82 review notes: auto-ping must be explicit opt-in (default off), with
// cooldown/timeout/retry and duplicate-scheduler protection, and failed or
// aborted pings must not corrupt quota state.
import { describe, expect, it, vi } from "vitest";
import { runQuotaAutoPingTick } from "../../src/shared/services/quotaAutoPing.js";
import { QUOTA_AUTOPING_CONFIG } from "../../src/shared/constants/config.js";

function makeDeps({ settings, connections = [], usage, pingResult = true, failRefresh = false }) {
  const conns = connections.map((c) => ({ authType: "oauth", ...c }));
  const state = { running: false, resetCache: {}, failureCache: {} };
  const deps = {
    getSettings: vi.fn(async () => settings),
    getProviderConnections: vi.fn(async () => conns),
    updateProviderConnection: vi.fn(async () => {}),
    resolveConnectionProxyConfig: vi.fn(async () => ({})),
    refreshAndUpdateCredentials: vi.fn(async (conn) => {
      if (failRefresh) throw new Error("refresh failed");
      return { connection: conn };
    }),
    proxyAwareFetch: vi.fn(),
    getExecutor: vi.fn(),
  };
  const handler = {
    getUsage: vi.fn(async () => usage),
    sendPing: vi.fn(async () => pingResult),
  };
  return { deps, state, handler };
}

describe("runQuotaAutoPingTick (opt-in + safety)", () => {
  const cfg = QUOTA_AUTOPING_CONFIG.providers.antigravity;

  it("does nothing when no connections are enabled (default off)", async () => {
    const { deps, state, handler } = makeDeps({
      settings: { [cfg.settingsKey]: { connections: {} } },
      connections: [{ id: "c1", providerSpecificData: {} }],
      usage: { quotas: { [cfg.quotaKey]: { resetAt: new Date(Date.now() - 1000).toISOString(), remaining: 1 } } },
    });
    await runQuotaAutoPingTick({ ...deps, providerHandlers: { antigravity: handler } }, state);
    expect(handler.sendPing).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("pings only connections explicitly enabled", async () => {
    const { deps, state, handler } = makeDeps({
      settings: { [cfg.settingsKey]: { connections: { c1: true } } },
      connections: [
        { id: "c1", providerSpecificData: {} },
        { id: "c2", providerSpecificData: {} },
      ],
      usage: { quotas: { [cfg.quotaKey]: { resetAt: new Date(Date.now() - 1000).toISOString(), remaining: 1 } } },
    });
    await runQuotaAutoPingTick({ ...deps, providerHandlers: { antigravity: handler } }, state);
    expect(handler.sendPing).toHaveBeenCalledTimes(1);
    // sendPing receives the enabled connection (c1)
    expect(handler.sendPing.mock.calls[0][0].id).toBe("c1");
  });

  it("skips when reset window already pinged (duplicate protection)", async () => {
    const { deps, state, handler } = makeDeps({
      settings: { [cfg.settingsKey]: { connections: { c1: true } } },
      connections: [{ id: "c1", lastPingedResetKey: "reset-1", providerSpecificData: {} }],
      usage: { quotas: { [cfg.quotaKey]: { resetAt: "2026-08-04T00:00:00.000Z", remaining: 1 } } },
    });
    // resetAt normalized to minute boundary matches the stored lastPingedResetKey
    const resetAt = "2026-08-04T00:00:00.000Z";
    const deps2 = {
      ...deps,
      getProviderConnections: vi.fn(async () => [{ id: "c1", lastPingedResetKey: resetAt, providerSpecificData: {} }]),
    };
    const usage2 = { quotas: { [cfg.quotaKey]: { resetAt, remaining: 1 } } };
    const handler2 = { ...handler, getUsage: vi.fn(async () => usage2) };
    await runQuotaAutoPingTick({ ...deps2, providerHandlers: { antigravity: handler2 } }, state);
    expect(handler2.sendPing).not.toHaveBeenCalled();
  });

  it("failed ping does not corrupt state: no lastPingedResetAt write, failure cooldown set", async () => {
    const { deps, state, handler } = makeDeps({
      settings: { [cfg.settingsKey]: { connections: { c1: true } } },
      connections: [{ id: "c1", providerSpecificData: {} }],
      usage: { quotas: { [cfg.quotaKey]: { resetAt: new Date(Date.now() - 1000).toISOString(), remaining: 1 } } },
      pingResult: false,
    });
    await runQuotaAutoPingTick({ ...deps, providerHandlers: { antigravity: handler } }, state);
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(state.failureCache["antigravity:c1"]).toBeTypeOf("number");
  });

  it("refresh failure is fail-soft: sets cooldown, does not ping", async () => {
    const { deps, state, handler } = makeDeps({
      settings: { [cfg.settingsKey]: { connections: { c1: true } } },
      connections: [{ id: "c1", providerSpecificData: {} }],
      usage: { quotas: { [cfg.quotaKey]: { resetAt: new Date(Date.now() - 1000).toISOString(), remaining: 1 } } },
      failRefresh: true,
    });
    await runQuotaAutoPingTick({ ...deps, providerHandlers: { antigravity: handler } }, state);
    expect(handler.sendPing).not.toHaveBeenCalled();
    expect(state.failureCache["antigravity:c1"]).toBeTypeOf("number");
  });
});
