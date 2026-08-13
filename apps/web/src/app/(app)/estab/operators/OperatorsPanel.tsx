"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, StatusPill, ActionButton } from "../../../_components/ds";

type Operator = {
  id: string;
  employeeId: string;
  division: string;
  section: string | null;
  deskRole: string;
  canInitiate: boolean;
  active: boolean;
  updatedAt: string;
};

type Employee = { id: string; name?: string; employeeId?: string; designation?: string };

const DESK_ROLES = [
  "dealing_hand", "section_officer", "under_secretary",
  "deputy_secretary", "director", "hod",
] as const;

const ROLE_LABEL: Record<string, string> = {
  dealing_hand: "Dealing Hand",
  section_officer: "Section Officer",
  under_secretary: "Under Secretary",
  deputy_secretary: "Deputy Secretary",
  director: "Director",
  hod: "Head of Department",
};

const EMPTY = { employeeId: "", division: "", section: "", deskRole: "dealing_hand", canInitiate: true };

export function OperatorsPanel() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/operators?activeOnly=false&limit=500");
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { data?: Operator[] };
      setOperators(body.data ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load operators");
    } finally {
      setLoading(false);
    }
  }, []);

  // Federate the employee directory from HRMS — no local duplication.
  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/v1/hrms/employees?limit=200");
      if (!res.ok) return;
      const body = (await res.json()) as { data?: Employee[] } | Employee[];
      setEmployees(Array.isArray(body) ? body : (body.data ?? []));
    } catch {
      /* picker is optional; manual UUID entry still works */
    }
  }, []);

  useEffect(() => { void load(); void loadEmployees(); }, [load, loadEmployees]);

  const empLabel = useCallback((id: string) => {
    const e = employees.find((x) => x.id === id);
    return e?.name ? `${e.name}${e.designation ? ` · ${e.designation}` : ""}` : id.slice(0, 8) + "…";
  }, [employees]);

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
    setSaving(true); setMessage(""); setError("");
    try {
      if (!/^[0-9a-f-]{36}$/i.test(form.employeeId)) throw new Error("Pick an employee or enter a valid employee ID");
      if (!form.division.trim()) throw new Error("Division is required");
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
      if (!res.ok) throw new Error((await res.text()) || "Enrol failed");
      setMessage("Operator enrolled. They can now be marked files in this division.");
      setForm({ ...EMPTY });
      setTimeout(() => void load(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrol failed");
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const toggle = useCallback(async (op: Operator) => {
    const res = await fetch(`/api/proxy/v1/estab/operators/${op.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !op.active }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Update failed");
    setMessage(`Operator ${op.active ? "deactivated" : "reactivated"}.`);
    setTimeout(() => void load(), 800);
  }, [load]);

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "var(--good)", fontSize: "0.875rem" }}>{message}</p> : null}
        {error ? <p style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p> : null}
      </div>

      <div className="card">
        <div className="card-h"><h3>Enrol a file operator</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Employee</span>
            {employees.length > 0 ? (
              <select value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Select employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name ?? e.employeeId ?? e.id}{e.designation ? ` · ${e.designation}` : ""}</option>
                ))}
              </select>
            ) : (
              <input value={form.employeeId} placeholder="employee UUID" onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
            )}
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Division / Wing</span>
            <input value={form.division} placeholder="e.g. Administration" onChange={(e) => setForm((f) => ({ ...f, division: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Section (optional)</span>
            <input value={form.section} placeholder="e.g. Estt-I" onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Desk role</span>
            <select value={form.deskRole} onChange={(e) => setForm((f) => ({ ...f, deskRole: e.target.value }))}>
              {DESK_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.8125rem", marginTop: 22 }}>
            <input type="checkbox" checked={form.canInitiate} onChange={(e) => setForm((f) => ({ ...f, canInitiate: e.target.checked }))} />
            <span>May initiate files</span>
          </label>
        </div>
        <div className="pad" style={{ paddingTop: 0 }}>
          <button className="btn primary" disabled={saving || !form.employeeId || !form.division} onClick={() => void enrol()}>
            {saving ? "Enrolling…" : "Enrol operator"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
      ) : grouped.length === 0 ? (
        <div className="card"><p className="pad" style={{ color: "#94a3b8" }}>No operators enrolled yet. Until you enrol operators, files cannot be marked to anyone.</p></div>
      ) : (
        grouped.map(([division, list]) => (
          <div className="card" key={division}>
            <div className="card-h"><h3>{division}</h3></div>
            <DataTable<Operator>
              columns={[
                { key: "employeeId", label: "Officer", render: (o) => <>{empLabel(o.employeeId)}</> },
                { key: "deskRole", label: "Desk", render: (o) => <>{ROLE_LABEL[o.deskRole] ?? o.deskRole}</> },
                { key: "section", label: "Section", render: (o) => <>{o.section ?? "—"}</> },
                { key: "canInitiate", label: "Initiate", render: (o) => <>{o.canInitiate ? "Yes" : "No"}</> },
                { key: "active", label: "Status", render: (o) => <StatusPill status={o.active ? "active" : "inactive"} /> },
                {
                  key: "id", label: "Actions", sortable: false,
                  render: (o) => (
                    <ActionButton
                      label={o.active ? "Deactivate" : "Reactivate"}
                      className="btn ghost"
                      danger={o.active}
                      confirmTitle={`${o.active ? "Deactivate" : "Reactivate"} this desk?`}
                      confirmDescription={o.active
                        ? "The officer will no longer be markable a file. Files they currently hold should be handed over first."
                        : "The officer will again be eligible to hold and operate files."}
                      confirmLabel={o.active ? "Deactivate" : "Reactivate"}
                      onConfirm={() => toggle(o)}
                    />
                  ),
                },
              ]}
              rows={list}
            />
          </div>
        ))
      )}
    </div>
  );
}
