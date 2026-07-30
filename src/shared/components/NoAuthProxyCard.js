"use client";

import { useEffect, useState } from "react";
import Card from "./Card";
import Select from "./Select";
import Badge from "./Badge";

const NONE_PROXY_POOL_VALUE = "__none__";

export default function NoAuthProxyCard({ providerId, isFreeNoAuth = true }) {
  const [proxyPools, setProxyPools] = useState([]);
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [rotateStrategy, setRotateStrategy] = useState("none");
  const [targetProxyPoolIds, setTargetProxyPoolIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store", signal: controller.signal }).then((r) => r.ok ? r.json() : { proxyPools: [] }),
      fetch("/api/settings", { cache: "no-store", signal: controller.signal }).then((r) => r.ok ? r.json() : {}),
    ]).then(([poolData, settingsData]) => {
      if (controller.signal.aborted) return;
      setProxyPools(poolData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProxyPoolId(override.proxyPoolId || NONE_PROXY_POOL_VALUE);
      setRotateStrategy(override.rotateStrategy || "none");
      setTargetProxyPoolIds(Array.isArray(override.targetProxyPoolIds) ? override.targetProxyPoolIds : []);
    }).catch(() => {});
    return () => controller.abort();
  }, [providerId]);

  const handleSave = async (updatedFields) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override = { ...(current[providerId] || {}) };

      if ("rotateStrategy" in updatedFields) {
        if (updatedFields.rotateStrategy === "none") {
          delete override.rotateStrategy;
        } else {
          override.rotateStrategy = updatedFields.rotateStrategy;
        }
      }
      if ("proxyPoolId" in updatedFields) {
        if (updatedFields.proxyPoolId === NONE_PROXY_POOL_VALUE) {
          delete override.proxyPoolId;
        } else {
          override.proxyPoolId = updatedFields.proxyPoolId;
        }
      }
      if ("targetProxyPoolIds" in updatedFields) {
        const ids = Array.isArray(updatedFields.targetProxyPoolIds) ? updatedFields.targetProxyPoolIds.filter(Boolean) : [];
        if (ids.length === 0) delete override.targetProxyPoolIds;
        else override.targetProxyPoolIds = ids;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      console.log("Save proxy override error:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleStrategyChange = (newVal) => {
    setRotateStrategy(newVal);
    handleSave({ rotateStrategy: newVal });
  };

  const handlePoolChange = (newVal) => {
    setProxyPoolId(newVal);
    handleSave({ proxyPoolId: newVal });
  };

  const toggleTargetPool = (poolId) => {
    const next = targetProxyPoolIds.includes(poolId)
      ? targetProxyPoolIds.filter((id) => id !== poolId)
      : [...targetProxyPoolIds, poolId];
    setTargetProxyPoolIds(next);
    handleSave({ targetProxyPoolIds: next });
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-green-500/10 text-green-500">
          <span className="material-symbols-outlined text-[20px]">lan</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Proxy Routing & Strategy</p>
          <p className="text-xs text-text-muted">
            Configure how traffic for this provider is routed through proxy pools.
          </p>
        </div>
        {savedFlash && <Badge variant="success" size="sm">Saved</Badge>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Proxy Strategy"
          value={rotateStrategy}
          onChange={(e) => handleStrategyChange(e.target.value)}
          disabled={saving}
          options={[
            { value: "none", label: "None (Direct / Static)" },
            { value: "round-robin", label: "Round-Robin (Rotate active pools)" },
            { value: "random", label: "Random (Rotate active pools)" },
          ]}
        />

        {rotateStrategy === "none" ? (
          isFreeNoAuth ? (
            <Select
              label="Static Proxy Pool"
              value={proxyPoolId}
              onChange={(e) => handlePoolChange(e.target.value)}
              disabled={saving}
              options={[
                { value: NONE_PROXY_POOL_VALUE, label: "None (direct)" },
                ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
              ]}
            />
          ) : (
            <div className="flex flex-col justify-end pb-1.5">
              <span className="text-xs text-text-muted italic">
                Using connection-level proxy settings. Select specific proxies on connections below or click "Apply Proxy".
              </span>
            </div>
          )
        ) : (
          <div className="flex flex-col justify-end pb-1.5">
            <span className="text-xs text-brand-500 font-medium">
              🔄 Dynamic Rotation active. Individual connection proxy settings will be bypassed.
            </span>
          </div>
        )}
      </div>

      {rotateStrategy !== "none" && (
        <div className="mt-4 rounded-xl border border-border/60 bg-surface/40 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-medium">Rotation proxy pool subset</p>
              <p className="text-xs text-text-muted">
                Select which active pools are eligible for {rotateStrategy}. Leave empty to use all active pools.
              </p>
            </div>
            <Badge variant="secondary" size="sm">
              {targetProxyPoolIds.length || proxyPools.length} / {proxyPools.length || 0} pools
            </Badge>
          </div>
          {proxyPools.length === 0 ? (
            <p className="text-xs text-warning">No active proxy pools with URLs found.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {proxyPools.map((pool) => {
                const checked = targetProxyPoolIds.includes(pool.id);
                return (
                  <label
                    key={pool.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${checked ? "border-primary/60 bg-primary/10" : "border-border/50 hover:bg-surface-2"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={() => toggleTargetPool(pool.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{pool.name || pool.id}</span>
                    <span className="text-[10px] text-text-muted font-mono">{pool.id.slice(0, 8)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
