import { useState } from "react";
import { CapacityBadges } from "@/shared/components";

export default function ModelRow({
  model,
  fullModel,
  alias,
  copied,
  onCopy,
  testStatus,
  isCustom,
  isFree,
  onDeleteAlias,
  onSetAlias,
  onTest,
  isTesting,
  onDisable,
  caps,
  thinkingSuffix,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alias || "");
  const [saving, setSaving] = useState(false);

  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  const displayId = alias || fullModel;
  const copyId = alias || fullModel;
  const copyKey = `model-${model.id}`;

  const saveAlias = async () => {
    const next = (draft || "").trim();

    if (next === alias) {
      setEditing(false);
      setDraft(alias || "");
      return;
    }

    if (!next) {
      if (alias && onDeleteAlias) {
        setSaving(true);
        try {
          await onDeleteAlias(alias);
          setEditing(false);
          setDraft("");
        } finally {
          setSaving(false);
        }
      } else {
        setEditing(false);
        setDraft(alias || "");
      }
      return;
    }

    if (!onSetAlias) return;
    setSaving(true);
    try {
      await onSetAlias(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`group min-w-0 max-w-full rounded-lg border px-3 py-2 ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span
          className="material-symbols-outlined shrink-0 text-base"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editing ? (
            <div className="flex min-w-0 items-center gap-1">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveAlias();
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraft(alias || "");
                  }
                }}
                placeholder="alias (any name)"
                disabled={saving}
                className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={saveAlias}
                disabled={saving}
                className="rounded p-0.5 text-primary hover:bg-primary/10"
                title="Save alias"
              >
                <span className="material-symbols-outlined text-sm">check</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(alias || "");
                }}
                className="rounded p-0.5 text-text-muted hover:bg-sidebar"
                title="Cancel"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          ) : (
            <code className="max-w-[72vw] truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px]">
              {displayId}
              {thinkingSuffix ? `(${thinkingSuffix})` : ""}
            </code>
          )}
          <span className="flex min-w-0 items-center text-[9px] gap-1 pl-1">
            {alias ? (
              <span className="truncate text-[9px] text-primary/80" title={fullModel}>
                → {fullModel}
              </span>
            ) : model.name ? (
              <span className="truncate text-[9px] italic text-text-muted/70">{model.name}</span>
            ) : null}
            {isFree && <span className="text-[9px] text-green-500/80">free</span>}
            <CapacityBadges caps={caps} colorOverride="text-text-muted/70" size={12} />
          </span>
        </div>
        {onTest && (
          <div className="relative shrink-0 group/btn">
            <button
              onClick={onTest}
              disabled={isTesting}
              className={`rounded p-0.5 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
            >
              <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        {typeof onSetAlias === "function" && !editing && (
          <div className="relative shrink-0 group/btn">
            <button
              type="button"
              onClick={() => {
                setDraft(alias || "");
                setEditing(true);
              }}
              className="rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-sidebar hover:text-primary sm:opacity-0 sm:group-hover:opacity-100"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {alias ? "Edit alias" : "Alias"}
            </span>
          </div>
        )}
        <div className="relative shrink-0 group/btn">
          <button
            onClick={() => onCopy(copyId, copyKey)}
            className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
          >
            <span className="material-symbols-outlined text-sm">
              {copied === copyKey ? "check" : "content_copy"}
            </span>
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === copyKey ? "Copied!" : "Copy"}
          </span>
        </div>
        {isCustom ? (
          <button
            onClick={onDeleteAlias}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            title="Remove custom model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        ) : onDisable ? (
          <button
            onClick={onDisable}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            title="Disable this model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
