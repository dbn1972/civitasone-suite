"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";

export type Perm = { module: string; action: string; resource?: string; allowed: boolean };

const DEFAULT_MODULES = ["finance", "procurement", "hr", "payroll", "projects", "grants", "assets", "audit", "legal", "admin"];
const ACTIONS = ["read", "create", "update", "delete", "approve", "export"];

type CellState = "inherit" | "allow" | "deny";

function key(m: string, a: string): string {
  return `${m}:${a}`;
}

export function PermissionGrid({
  roleId,
  permissions,
  editable,
}: {
  roleId: string;
  permissions: Perm[];
  editable: boolean;
}) {
  const router = useRouter();

  // Baseline state derived from existing permissions.
  const baseline = useMemo(() => {
    const map: Record<string, CellState> = {};
    for (const p of permissions) {
      map[key(p.module, p.action)] = p.allowed ? "allow" : "deny";
    }
    return map;
  }, [permissions]);

  const modules = useMemo(() => {
    const set = new Set<string>(DEFAULT_MODULES);
    for (const p of permissions) set.add(p.module);
    return Array.from(set).sort();
  }, [permissions]);

  const [draft, setDraft] = useState<Record<string, CellState>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");

  function stateOf(m: string, a: string): CellState {
    const k = key(m, a);
    return draft[k] ?? baseline[k] ?? "inherit";
  }

  function cycle(m: string, a: string) {
    if (!editable) return;
    const k = key(m, a);
    const current = stateOf(m, a);
    const next: CellState = current === "inherit" ? "allow" : current === "allow" ? "deny" : "inherit";
    setDraft((d) => {
      const copy = { ...d };
      // If the next state equals the baseline, drop the override.
      if ((baseline[k] ?? "inherit") === next) delete copy[k];
      else copy[k] = next;
      return copy;
    });
    setNotice("");
  }

  // Only cells that differ from the baseline AND are allow/deny can be saved
  // (the backend is additive: POST /policy/roles/:id/permissions). Reverting a
  // cell to "inherit" cannot be persisted — the backend exposes no removal route.
  const changed = Object.entries(draft).filter(([k, v]) => v !== (baseline[k] ?? "inherit"));
  const savable = changed.filter(([, v]) => v !== "inherit");
  const unremovable = changed.filter(([, v]) => v === "inherit");
  const dirty = changed.length > 0;

  async function save(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      for (const [k, v] of savable) {
        const [resource, action] = k.split(":");
        const res = await fetch(`/api/proxy/policy/roles/${roleId}/permissions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(reason ? { "x-correlation-id": reason.slice(0, 64) } : {}) },
          body: JSON.stringify({ resource, action, effect: v === "deny" ? "deny" : "allow" }),
        });
        if (!res.ok) {
          const text = await res.text();
          let msg = text || `Request failed (${res.status})`;
          try { const j = JSON.parse(text) as { message?: string }; if (j.message) msg = j.message; } catch { /* */ }
          throw new Error(`${resource}:${action} — ${msg}`);
        }
      }
      setConfirmOpen(false);
      setDraft({});
      setNotice(
        `${savable.length} permission change${savable.length === 1 ? "" : "s"} saved.` +
          (unremovable.length > 0 ? ` ${unremovable.length} reset-to-inherit change${unremovable.length === 1 ? "" : "s"} could not be applied — the policy service has no permission-removal endpoint.` : ""),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save permissions.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="perm-grid-heading">Permission grid</h3>
        {editable ? (
          <button type="button" className="btn primary sm" disabled={!dirty || busy} onClick={() => { setError(undefined); setConfirmOpen(true); }}>
            {busy ? "Saving…" : dirty ? `Save ${savable.length || ""} change${savable.length === 1 ? "" : "s"}`.trim() : "Save changes"}
          </button>
        ) : (
          <span className="pill mut">Read-only (system role)</span>
        )}
      </div>

      {notice ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "#067647", margin: 0, padding: "8px 16px 0" }}>{notice}</p>
      ) : null}
      {editable ? (
        <p style={{ fontSize: 12, color: "#667085", margin: 0, padding: "8px 16px 0" }}>
          Click a cell to cycle <b>Inherit → Allow → Deny</b>. Saving records each change in the audit log.
        </p>
      ) : null}

      <div className="pad" style={{ overflowX: "auto" }}>
        <table className="tbl" aria-labelledby="perm-grid-heading">
          <thead>
            <tr>
              <th scope="col">Module</th>
              {ACTIONS.map((a) => <th key={a} scope="col" style={{ textTransform: "capitalize", textAlign: "center" }}>{a}</th>)}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m}>
                <th scope="row" style={{ fontWeight: 600 }}><span className="mono">{m}</span></th>
                {ACTIONS.map((a) => {
                  const st = stateOf(m, a);
                  const isDraft = draft[key(m, a)] !== undefined;
                  return (
                    <td key={a} style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={() => cycle(m, a)}
                        disabled={!editable}
                        aria-pressed={st !== "inherit"}
                        aria-label={`${m} ${a}: ${st}${isDraft ? " (unsaved)" : ""}`}
                        title={editable ? `Click to change — currently ${st}` : st}
                        style={{
                          minWidth: 64, padding: "4px 8px", borderRadius: 20, fontSize: 11.5, fontWeight: 650,
                          cursor: editable ? "pointer" : "default", border: "1px solid transparent",
                          outline: isDraft ? "2px dashed var(--primary)" : undefined, outlineOffset: 1,
                          ...cellStyle(st),
                        }}
                      >
                        {st === "allow" ? "Allow" : st === "deny" ? "Deny" : "—"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Save permission changes?"
        description={
          <>
            You are applying <b>{savable.length}</b> permission change{savable.length === 1 ? "" : "s"} to this role.
            {unremovable.length > 0 ? (
              <> {unremovable.length} reset-to-inherit change{unremovable.length === 1 ? "" : "s"} cannot be applied (no removal endpoint) and will be skipped.</>
            ) : null}
            {" "}This takes effect immediately for everyone assigned to the role.
          </>
        }
        confirmLabel="Save changes"
        requireReason
        reasonLabel="Reason for change (maker-checker, audited)"
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void save(reason)}
        onCancel={() => { if (!busy) { setConfirmOpen(false); setError(undefined); } }}
      />
    </div>
  );
}

function cellStyle(st: CellState): React.CSSProperties {
  if (st === "allow") return { background: "var(--goodbg)", color: "var(--good)", borderColor: "var(--goodbd)" };
  if (st === "deny") return { background: "var(--badbg)", color: "var(--bad)", borderColor: "var(--badbd)" };
  return { background: "var(--line2)", color: "var(--ink2)" };
}
