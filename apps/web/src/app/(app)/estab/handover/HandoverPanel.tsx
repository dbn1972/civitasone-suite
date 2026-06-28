"use client";

import { useCallback, useEffect, useState } from "react";
import { DataTable, StatusPill } from "../../../_components/ds";

type Operator = { id: string; employeeId: string; division: string; deskRole: string; active: boolean };
type Handover = {
  id: string;
  fromOfficerId: string;
  toOfficerId: string;
  reason: string;
  remarks: string | null;
  fileCount: number;
  status: string;
  createdAt: string;
};

const REASONS = ["transfer", "leave", "retirement", "suspension"] as const;
const EMPTY = { fromOfficerId: "", toOfficerId: "", reason: "transfer", remarks: "" };

export function HandoverPanel() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [rows, setRows] = useState<Handover[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [opRes, hoRes] = await Promise.all([
        fetch("/api/proxy/v1/estab/operators?activeOnly=false&limit=500"),
        fetch("/api/proxy/v1/estab/handovers?limit=100"),
      ]);
      if (opRes.ok) setOperators(((await opRes.json()) as { data?: Operator[] }).data ?? []);
      if (hoRes.ok) setRows(((await hoRes.json()) as { data?: Handover[] }).data ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const label = useCallback((empId: string) => {
    const o = operators.find((x) => x.employeeId === empId);
    return o ? `${empId.slice(0, 8)}… · ${o.division}` : empId.slice(0, 8) + "…";
  }, [operators]);

  const submit = useCallback(async () => {
    setSaving(true); setMessage(""); setError("");
    try {
      if (!form.fromOfficerId || !form.toOfficerId) throw new Error("Select both officers");
      if (form.fromOfficerId === form.toOfficerId) throw new Error("Officers must differ");
      const res = await fetch("/api/proxy/v1/estab/handovers", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromOfficerId: form.fromOfficerId, toOfficerId: form.toOfficerId,
          reason: form.reason, ...(form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Handover failed");
      setMessage("Charge handover queued — files are being reassigned.");
      setForm({ ...EMPTY });
      setTimeout(() => void load(), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handover failed");
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const activeOps = operators.filter((o) => o.active);

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "#047857", fontSize: "0.875rem" }}>{message}</p> : null}
        {error ? <p style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{error}</p> : null}
      </div>

      <div className="card">
        <div className="card-h"><h3>New charge handover</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>From officer (outgoing)</span>
            <select value={form.fromOfficerId} onChange={(e) => setForm((f) => ({ ...f, fromOfficerId: e.target.value }))}>
              <option value="">Select…</option>
              {operators.map((o) => <option key={o.id} value={o.employeeId}>{o.employeeId.slice(0, 8)}… · {o.division} · {o.deskRole}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>To officer (must be active operator)</span>
            <select value={form.toOfficerId} onChange={(e) => setForm((f) => ({ ...f, toOfficerId: e.target.value }))}>
              <option value="">Select…</option>
              {activeOps.map((o) => <option key={o.id} value={o.employeeId}>{o.employeeId.slice(0, 8)}… · {o.division} · {o.deskRole}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Reason</span>
            <select value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}>
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Remarks (optional)</span>
            <input value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </label>
        </div>
        <div className="pad" style={{ paddingTop: 0 }}>
          <button className="btn primary" disabled={saving || !form.fromOfficerId || !form.toOfficerId} onClick={() => void submit()}>
            {saving ? "Handing over…" : "Hand over charge"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Handover history</h3></div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="pad" style={{ color: "#94a3b8" }}>No handovers recorded.</p>
        ) : (
          <DataTable<Handover>
            columns={[
              { key: "fromOfficerId", label: "From", render: (h) => <>{label(h.fromOfficerId)}</> },
              { key: "toOfficerId", label: "To", render: (h) => <>{label(h.toOfficerId)}</> },
              { key: "reason", label: "Reason" },
              { key: "fileCount", label: "Files moved" },
              { key: "status", label: "Status", render: (h) => <StatusPill status={h.status} /> },
            ]}
            rows={rows}
          />
        )}
      </div>
    </div>
  );
}
