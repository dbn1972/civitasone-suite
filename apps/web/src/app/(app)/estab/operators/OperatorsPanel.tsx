"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, DataTable, StatusPill, ActionButton, ErrorState, EntityPicker, Field, Input, Select } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { humanizeStatus } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";

type Operator = {
  id: string;
  employeeId: string;
  employeeName?: string;
  departmentName?: string;
  division: string;
  section: string | null;
  deskRole: string;
  canInitiate: boolean;
  active: boolean;
  updatedAt: string;
};

const DESK_ROLES = [
  "dealing_hand", "section_officer", "under_secretary",
  "deputy_secretary", "director", "hod",
] as const;

// Hand-written labels where the generic Title Case would read oddly; anything
// not here is humanized via humanizeStatus() (OPERATORS-06), so an unknown
// server enum (e.g. "joint_secretary") shows "Joint Secretary", not raw.
const ROLE_LABEL: Record<string, string> = {
  dealing_hand: "Dealing Hand",
  section_officer: "Section Officer",
  under_secretary: "Under Secretary",
  deputy_secretary: "Deputy Secretary",
  director: "Director",
  hod: "Head of Department",
};
function deskRoleLabel(role: string): string {
  return ROLE_LABEL[role] ?? humanizeStatus(role);
}

const EMPTY = { employeeId: "", division: "", section: "", deskRole: "dealing_hand", canInitiate: true };
const MESSAGE_DISMISS_MS = 5000;

export function OperatorsPanel({ canAdminister }: { canAdminister: boolean }) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ employeeId?: string; division?: string }>({});
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const { fromResponse, fromException, clear } = useFormError("operator");
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=false&limit=500", { signal });
      if (!res.ok) throw new Error("Could not load operators.");
      const body = (await res.json()) as { data?: Operator[] };
      setOperators(body.data ?? []);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, [load]);

  // GAP-ESTAB-OPERATORS-05: show a transient success message that auto-clears,
  // never one that lingers beside a later error. Timers are cleared on unmount.
  const flash = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => {
      if (mounted.current) setMessage("");
    }, MESSAGE_DISMISS_MS);
  }, []);

  // GAP-ESTAB-OPERATORS-01: Officer column shows the resolved name (from the
  // enriched operator row), falling back to a short-id hint only when the
  // directory could not resolve it — never a bare UUID masquerading as a name.
  const empLabel = useCallback((o: Operator) => {
    if (o.employeeName) {
      return o.departmentName ? `${o.employeeName} · ${o.departmentName}` : o.employeeName;
    }
    return `Unresolved (${o.employeeId.slice(0, 8)}…)`;
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Operator[]>();
    for (const o of operators) {
      const list = map.get(o.division) ?? [];
      list.push(o);
      map.set(o.division, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [operators]);

  const enrol = useCallback(async () => {
    setSaving(true); setMessage(""); setError(""); setFieldErrors({});
    clear();
    // GAP-ESTAB-OPERATORS-04: validate per-field (shown beside the field via
    // Field's aria wiring), not as a single banner far from the input.
    const errs: { employeeId?: string; division?: string } = {};
    if (!/^[0-9a-f-]{36}$/i.test(form.employeeId)) errs.employeeId = "Pick an employee from the directory.";
    if (!form.division.trim()) errs.division = "Division is required.";
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setSaving(false);
      return;
    }
    try {
      const payload = {
        employeeId: form.employeeId,
        division: form.division.trim(),
        ...(form.section.trim() ? { section: form.section.trim() } : {}),
        deskRole: form.deskRole,
        canInitiate: form.canInitiate,
      };
      const res = await fetch("/api/proxy/v1/estab/operators", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const result = await fromResponse(res, "save");
        setError(result.message);
        setFieldErrors((prev) => ({
          ...prev,
          ...(result.fieldErrors.employeeId ? { employeeId: result.fieldErrors.employeeId } : {}),
          ...(result.fieldErrors.division ? { division: result.fieldErrors.division } : {}),
        }));
        return;
      }
      setForm({ ...EMPTY });
      // GAP-ESTAB-OPERATORS-05: reload directly (await), not after a fixed delay.
      await load();
      flash("Operator enrolled. They can now be marked files in this division.");
    } catch (err) {
      setError(fromException("save", err).message);
    } finally {
      setSaving(false);
    }
  }, [form, load, flash, fromResponse, fromException, clear]);

  const toggle = useCallback(async (op: Operator) => {
    const res = await fetch(`/api/proxy/v1/estab/operators/${op.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !op.active }),
    });
    if (!res.ok) {
      throw UserFacingError.from(await fromResponse(res, "save"));
    }
    await load();
    flash(`Operator ${op.active ? "deactivated" : "reactivated"}.`);
  }, [load, flash, fromResponse]);

  const columns = useMemo(() => {
    const base = [
      { key: "employeeId" as const, label: "Officer", render: (o: Operator) => <>{empLabel(o)}</> },
      { key: "deskRole" as const, label: "Desk", render: (o: Operator) => <>{deskRoleLabel(o.deskRole)}</> },
      { key: "section" as const, label: "Section", render: (o: Operator) => <>{o.section ?? "—"}</> },
      {
        key: "canInitiate" as const, label: "Initiate",
        render: (o: Operator) => <StatusPill status={o.canInitiate ? "active" : "inactive"} label={o.canInitiate ? "Yes" : "No"} />,
      },
      { key: "active" as const, label: "Status", render: (o: Operator) => <StatusPill status={o.active ? "active" : "inactive"} /> },
    ];
    if (!canAdminister) return base;
    return [
      ...base,
      {
        key: "id" as const, label: "Actions", sortable: false,
        render: (o: Operator) => (
          <ActionButton
            label={o.active ? "Deactivate" : "Reactivate"}
            className="btn ghost"
            danger={o.active}
            confirmTitle={`${o.active ? "Deactivate" : "Reactivate"} this desk?`}
            confirmDescription={o.active
              ? "The officer will no longer be markable a file. Hand over any files they currently hold before deactivating — this does not reassign them automatically."
              : "The officer will again be eligible to hold and operate files."}
            confirmLabel={o.active ? "Deactivate" : "Reactivate"}
            onConfirm={() => toggle(o)}
          />
        ),
      },
    ];
  }, [canAdminister, empLabel, toggle]);

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "var(--good)", fontSize: "0.875rem" }}>{message}</p> : null}
      </div>
      <div role="alert" aria-live="assertive">
        {error ? <p style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p> : null}
      </div>

      {canAdminister ? (
        <div className="card">
          <div className="card-h"><h3>Enrol a file operator</h3></div>
          <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <Field label="Employee" required error={fieldErrors.employeeId}>
              {/* GAP-ESTAB-OPERATORS-01/04: searchable directory picker (server
                  `q` search, name + designation), returns a real hrms id — no
                  200-row cap, no raw-UUID fallback box. */}
              <EntityPicker
                value={form.employeeId || null}
                onChange={(v) => setForm((f) => ({ ...f, employeeId: Array.isArray(v) ? (v[0] ?? "") : (v ?? "") }))}
                search={searchEmployees}
                resolve={resolveEmployees}
                placeholder="Search an employee by name…"
                aria-label="Employee"
              />
            </Field>
            <Field label="Division / Wing" required error={fieldErrors.division}>
              <Input value={form.division} placeholder="e.g. Administration" onChange={(e) => setForm((f) => ({ ...f, division: e.target.value }))} />
            </Field>
            <Field label="Section (optional)">
              <Input value={form.section} placeholder="e.g. Estt-I" onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))} />
            </Field>
            <Field label="Desk role">
              <Select value={form.deskRole} onChange={(e) => setForm((f) => ({ ...f, deskRole: e.target.value }))}>
                {DESK_ROLES.map((r) => <option key={r} value={r}>{deskRoleLabel(r)}</option>)}
              </Select>
            </Field>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.8125rem", marginTop: 22 }}>
              <input type="checkbox" checked={form.canInitiate} onChange={(e) => setForm((f) => ({ ...f, canInitiate: e.target.checked }))} />
              <span>May initiate files</span>
            </label>
          </div>
          <div className="pad" style={{ paddingTop: 0 }}>
            <Button disabled={saving} onClick={() => void enrol()}>
              {saving ? "Enrolling…" : "Enrol operator"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="pad" role="note" style={{ color: "var(--mut)", fontSize: "0.875rem" }}>
            You can view the operator roster. Enrolling or deactivating operators is restricted to division administrators.
          </p>
        </div>
      )}

      {loading ? (
        <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>Loading…</p>
      ) : loadError ? (
        <div className="card"><div className="pad"><ErrorState error={toHumanError("load", { area: "operator roster" })} onRetry={() => void load()} /></div></div>
      ) : grouped.length === 0 ? (
        <div className="card"><p className="pad" style={{ color: "var(--mut)" }}>No operators enrolled yet. Until you enrol operators, files cannot be marked to anyone.</p></div>
      ) : (
        grouped.map(([division, list]) => (
          <div className="card" key={division}>
            <div className="card-h"><h3>{division}</h3></div>
            <DataTable<Operator> columns={columns} rows={list} />
          </div>
        ))
      )}
    </div>
  );
}
