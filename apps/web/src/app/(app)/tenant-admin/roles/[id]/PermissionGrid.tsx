"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, ConfirmDialog } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

export type Perm = { module: string; action: string; resource?: string; allowed: boolean };

const DEFAULT_MODULES = ["finance", "procurement", "hr", "payroll", "projects", "grants", "assets", "audit", "legal", "admin"];
const ACTIONS = ["read", "create", "update", "delete", "approve", "export"] as const;
type Action = typeof ACTIONS[number];

type CellState = "inherit" | "allow" | "deny";

function key(m: string, a: string): string {
  return `${m}:${a}`;
}

function cellStyle(st: CellState): React.CSSProperties {
  if (st === "allow") return { background: "var(--goodbg)", color: "var(--good)", borderColor: "var(--goodbd)" };
  if (st === "deny") return { background: "var(--badbg)", color: "var(--bad)", borderColor: "var(--badbd)" };
  return { background: "var(--line2)", color: "var(--ink2)" };
}

type ModuleRow = { module: string } & Record<string, unknown>;

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
  const formError = useFormError("permission");

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
    const hasBaseline = (baseline[k] ?? "inherit") !== "inherit";
    // GAP-TENANT-ADMIN-ROLES-DETAIL-01: there is no permission-REMOVAL endpoint,
    // so a reset-to-inherit of a saved cell can never be persisted. Rather than
    // advertise "Inherit" as a step and then silently skip it on save, a cell
    // that already has a saved baseline cycles ONLY Allow <-> Deny. A cell with
    // no baseline still offers Inherit -> Allow -> Deny (nothing to remove).
    const next: CellState = hasBaseline
      ? current === "allow" ? "deny" : "allow"
      : current === "inherit" ? "allow" : current === "allow" ? "deny" : "inherit";
    setDraft((d) => {
      const copy = { ...d };
      if ((baseline[k] ?? "inherit") === next) delete copy[k];
      else copy[k] = next;
      return copy;
    });
    setNotice("");
  }

  const changed = Object.entries(draft).filter(([k, v]) => v !== (baseline[k] ?? "inherit"));
  // With DETAIL-01 in place no draft can target "inherit" for a baselined cell,
  // so `savable` is simply every change; `unremovable` stays as a defensive
  // guard (should always be empty now).
  const savable = changed.filter(([, v]) => v !== "inherit");
  const dirty = changed.length > 0;

  async function save(reason?: string) {
    setBusy(true);
    setError(undefined);
    formError.clear();
    // GAP-TENANT-ADMIN-ROLES-DETAIL-02: apply changes one by one but track which
    // succeeded. On a mid-way failure, drop the succeeded cells from the draft,
    // refresh from the server, and report "N of M saved; K failed" instead of
    // leaving the role half-updated with a stale baseline and a retry that
    // re-POSTs already-applied cells.
    const succeeded: string[] = [];
    let failureMessage: string | null = null;
    try {
      for (const [k, v] of savable) {
        const [resource, action] = k.split(":");
        const res = await fetch(`/api/proxy/policy/roles/${roleId}/permissions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // GAP-TENANT-ADMIN-ROLES-DETAIL-04: reason travels in the BODY (zod-
          // capped at 500 server-side), NOT as a truncated x-correlation-id
          // header. The proxy supplies a real correlation id for tracing.
          body: JSON.stringify({ resource, action, effect: v === "deny" ? "deny" : "allow", ...(reason ? { reason } : {}) }),
        });
        if (!res.ok) {
          const resolved = await formError.fromResponse(res, "save");
          failureMessage = `${resource}:${action} — ${resolved.message}`;
          break;
        }
        succeeded.push(k);
      }
    } catch (err) {
      failureMessage = formError.fromException("save", err).message;
    }

    if (failureMessage) {
      // Remove the cells that DID apply so a retry does not re-POST them.
      setDraft((d) => {
        const copy = { ...d };
        for (const k of succeeded) delete copy[k];
        return copy;
      });
      // Keep the dialog open so the N-of-M result stays visible; the server
      // refresh updates the baseline for the cells that did apply.
      setError(
        `${succeeded.length} of ${savable.length} change${savable.length === 1 ? "" : "s"} saved; ` +
          `${savable.length - succeeded.length} failed: ${failureMessage}`,
      );
      router.refresh();
      setBusy(false);
      return;
    }

    setConfirmOpen(false);
    setDraft({});
    setNotice(`${savable.length} permission change${savable.length === 1 ? "" : "s"} saved.`);
    router.refresh();
    setBusy(false);
  }

  const rows: ModuleRow[] = modules.map((m) => ({ module: m }));

  // Build a column for "Module" and one per action, each with a custom render
  // that reads from component-level state closures for interactive cycling.
  const actionColumns = ACTIONS.map((a: Action) => ({
    key: a as string,
    label: a.charAt(0).toUpperCase() + a.slice(1),
    align: "center" as const,
    sortable: false,
    render: (row: ModuleRow) => {
      const m = row.module as string;
      const st = stateOf(m, a);
      const isDraft = draft[key(m, a)] !== undefined;
      return (
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
      );
    },
  }));

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="perm-grid-heading">Permission grid</h3>
        {editable ? (
          <Button size="sm" disabled={!dirty || busy} onClick={() => { setError(undefined); setConfirmOpen(true); }}>
            {busy ? "Saving…" : dirty ? `Save ${savable.length || ""} change${savable.length === 1 ? "" : "s"}`.trim() : "Save changes"}
          </Button>
        ) : (
          <span className="pill mut">Read-only (system role)</span>
        )}
      </div>

      {notice ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12.5, color: "var(--civitas-color-primary)", margin: 0, padding: "8px 16px 0" }}>{notice}</p>
      ) : null}
      {editable ? (
        <p style={{ fontSize: 12, color: "var(--civitas-color-text-muted)", margin: 0, padding: "8px 16px 0" }}>
          Click a cell to change it. A new cell cycles <b>Inherit → Allow → Deny</b>; a saved cell toggles <b>Allow ⇄ Deny</b> (resetting a saved permission to Inherit is not yet supported). Saving records each change in the audit log.
        </p>
      ) : null}

      <div aria-labelledby="perm-grid-heading" style={{ overflowX: "auto" }}>
        <DataTable<ModuleRow>
          columns={[
            {
              key: "module",
              label: "Module",
              render: (row) => <span className="mono" style={{ fontWeight: 600 }}>{row.module as string}</span>,
            },
            ...actionColumns,
          ]}
          rows={rows}
        />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Save permission changes?"
        description={
          <>
            You are applying <b>{savable.length}</b> permission change{savable.length === 1 ? "" : "s"} to this role.
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
