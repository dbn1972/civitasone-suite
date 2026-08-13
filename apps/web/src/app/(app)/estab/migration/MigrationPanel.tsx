"use client";

import { useCallback, useEffect, useState } from "react";
import { DataTable, StatusPill } from "../../../_components/ds";

type MigrationRow = {
  id: string;
  legacyFileNo: string;
  subject: string;
  dept: string;
  pageCount: number;
  scanRef: string | null;
  efileId: string | null;
  status: string;
  createdAt: string;
};

const EMPTY = { legacyFileNo: "", subject: "", dept: "", pageCount: "0", scanRef: "" };

export function MigrationPanel() {
  const [rows, setRows] = useState<MigrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proxy/v1/estab/migration?limit=100");
      if (!res.ok) throw new Error(await res.text());
      setRows(((await res.json()) as { data?: MigrationRow[] }).data ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const register = useCallback(async () => {
    setSaving(true); setMessage(""); setError("");
    try {
      if (!form.legacyFileNo.trim() || form.subject.trim().length < 3 || !form.dept.trim()) {
        throw new Error("Legacy file no, subject and department are required");
      }
      const res = await fetch("/api/proxy/v1/estab/migration", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legacyFileNo: form.legacyFileNo.trim(),
          subject: form.subject.trim(),
          dept: form.dept.trim(),
          pageCount: Number(form.pageCount || "0"),
          ...(form.scanRef.trim() ? { scanRef: form.scanRef.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Register failed");
      setMessage("Legacy file registered.");
      setForm({ ...EMPTY });
      setTimeout(() => void load(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Register failed");
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "var(--good)", fontSize: "0.875rem" }}>{message}</p> : null}
        {error ? <p style={{ color: "var(--bad)", fontSize: "0.875rem" }}>{error}</p> : null}
      </div>

      <div className="card">
        <div className="card-h"><h3>Register a legacy file</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Legacy file no</span>
            <input value={form.legacyFileNo} onChange={(e) => setForm((f) => ({ ...f, legacyFileNo: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Department</span>
            <input value={form.dept} onChange={(e) => setForm((f) => ({ ...f, dept: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Pages</span>
            <input type="number" min={0} value={form.pageCount} onChange={(e) => setForm((f) => ({ ...f, pageCount: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
            <span>Scan reference (optional)</span>
            <input value={form.scanRef} placeholder="storage key / URL" onChange={(e) => setForm((f) => ({ ...f, scanRef: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem", gridColumn: "1 / -1" }}>
            <span>Subject</span>
            <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
          </label>
        </div>
        <div className="pad" style={{ paddingTop: 0 }}>
          <button className="btn primary" disabled={saving} onClick={() => void register()}>
            {saving ? "Registering…" : "Register file"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Migration register</h3></div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="pad" style={{ color: "#94a3b8" }}>No legacy files registered yet.</p>
        ) : (
          <DataTable<MigrationRow>
            columns={[
              { key: "legacyFileNo", label: "Legacy No", render: (r) => <span className="mono">{r.legacyFileNo}</span> },
              { key: "subject", label: "Subject" },
              { key: "dept", label: "Dept" },
              { key: "pageCount", label: "Pages" },
              { key: "efileId", label: "eFile", render: (r) => r.efileId
                ? <a className="mono" style={{ color: "#4f46e5" }} href={`/estab/files/${r.efileId}`}>{r.efileId.slice(0, 8)}…</a>
                : <>—</> },
              { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
            ]}
            rows={rows}
          />
        )}
      </div>
    </div>
  );
}
