"use client";

import { useCallback, useEffect, useState } from "react";
import { DataTable, StatusPill, ActionButton, Segmented } from "../../../_components/ds";

type Dfa = {
  id: string;
  dfaNo: string;
  communicationType: string;
  subject: string;
  status: string;
  editable: boolean;
  recipientName: string | null;
  updatedAt: string;
};

const COMM_TYPES = ["letter", "order", "memo", "notification", "circular", "do_letter"] as const;
const FILTERS = ["all", "draft", "pending_approval", "approved", "signed", "dispatched"] as const;

const EMPTY = { communicationType: "letter", subject: "", body: "", recipientName: "", recipientAddress: "" };

export function DfaPanel() {
  const [rows, setRows] = useState<Dfa[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === "all" ? "?limit=100" : `?status=${filter}&limit=100`;
      const res = await fetch(`/api/proxy/v1/estab/dfa${qs}`);
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as { data?: Dfa[] };
      setRows(body.data ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load DFAs");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    setSaving(true); setMessage(""); setError("");
    try {
      if (form.subject.trim().length < 3) throw new Error("Subject is required");
      if (form.body.trim().length < 1) throw new Error("Draft body is required");
      const payload = {
        communicationType: form.communicationType,
        subject: form.subject.trim(),
        body: form.body.trim(),
        ...(form.recipientName.trim() ? { recipientName: form.recipientName.trim() } : {}),
        ...(form.recipientAddress.trim() ? { recipientAddress: form.recipientAddress.trim() } : {}),
      };
      const res = await fetch("/api/proxy/v1/estab/dfa", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.text()) || "Create failed");
      setMessage("Draft created. Edit it, then submit for approval.");
      setForm({ ...EMPTY }); setShowForm(false);
      setTimeout(() => void load(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }, [form, load]);

  const act = useCallback(async (id: string, action: string, reason?: string) => {
    const res = await fetch(`/api/proxy/v1/estab/dfa/${id}/${action}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: reason ? JSON.stringify({ reason }) : JSON.stringify({}),
    });
    if (!res.ok) throw new Error((await res.text()) || `${action} failed`);
    setMessage(`DFA ${action} done.`);
    setTimeout(() => void load(), 800);
  }, [load]);

  const actionsFor = (d: Dfa) => {
    switch (d.status) {
      case "draft":
      case "returned":
        return (
          <ActionButton label="Submit" className="btn primary"
            confirmTitle="Submit this draft for approval?"
            confirmDescription="The draft will be locked from editing while it is under approval."
            confirmLabel="Submit" onConfirm={() => act(d.id, "submit")} />
        );
      case "pending_approval":
        return (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <ActionButton label="Approve" className="btn primary"
              confirmTitle="Approve this draft?" confirmLabel="Approve"
              onConfirm={() => act(d.id, "approve")} />
            <ActionButton label="Return" className="btn ghost" danger requireReason reasonLabel="Reason for return"
              confirmTitle="Return this draft?" confirmDescription="It will go back for revision."
              confirmLabel="Return" onConfirm={(r) => act(d.id, "return", r)} />
          </div>
        );
      case "approved":
        return (
          <ActionButton label="Sign" className="btn primary"
            confirmTitle="Record signing of this DFA?"
            confirmDescription="Records who signed and when. Cryptographic e-Sign/DSC arrives in Phase 2."
            confirmLabel="Sign" onConfirm={() => act(d.id, "sign")} />
        );
      case "signed":
        return (
          <ActionButton label="Dispatch" className="btn primary"
            confirmTitle="Dispatch this communication?"
            confirmDescription="A dispatch record will be created and the DFA closed."
            confirmLabel="Dispatch" onConfirm={() => act(d.id, "dispatch")} />
        );
      default:
        return <span style={{ color: "#94a3b8" }}>—</span>;
    }
  };

  return (
    <div style={{ display: "grid", gap: 18, marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Segmented
          options={[...FILTERS]}
          value={filter}
          onChange={(v) => setFilter(v as (typeof FILTERS)[number])}
        />
        <button className="btn primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New draft"}</button>
      </div>

      <div role="status" aria-live="polite">
        {message ? <p style={{ color: "#047857", fontSize: "0.875rem" }}>{message}</p> : null}
        {error ? <p style={{ color: "#b91c1c", fontSize: "0.875rem" }}>{error}</p> : null}
      </div>

      {showForm ? (
        <div className="card">
          <div className="card-h"><h3>New draft</h3></div>
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span>Type</span>
                <select value={form.communicationType} onChange={(e) => setForm((f) => ({ ...f, communicationType: e.target.value }))}>
                  {COMM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
                <span>Recipient name (external)</span>
                <input value={form.recipientName} onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))} />
              </label>
            </div>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Subject</span>
              <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Recipient address (external, optional)</span>
              <input value={form.recipientAddress} onChange={(e) => setForm((f) => ({ ...f, recipientAddress: e.target.value }))} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>Draft body</span>
              <textarea rows={6} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
            </label>
            <div>
              <button className="btn primary" disabled={saving || !form.subject || !form.body} onClick={() => void create()}>
                {saving ? "Creating…" : "Create draft"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "#94a3b8" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="pad" style={{ color: "#94a3b8" }}>No drafts in this view.</p>
        ) : (
          <DataTable<Dfa>
            columns={[
              { key: "dfaNo", label: "DFA No", render: (d) => <span className="mono">{d.dfaNo}</span> },
              { key: "communicationType", label: "Type", render: (d) => <>{d.communicationType.replace(/_/g, " ")}</> },
              { key: "subject", label: "Subject" },
              { key: "recipientName", label: "Recipient", render: (d) => <>{d.recipientName ?? "—"}</> },
              { key: "status", label: "Status", render: (d) => <StatusPill status={d.status} /> },
              { key: "id", label: "Action", sortable: false, render: (d) => actionsFor(d) },
            ]}
            rows={rows}
          />
        )}
      </div>
    </div>
  );
}
