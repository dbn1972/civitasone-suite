"use client";
/**
 * DocumentTypesEditor — BRD §7.12 DM-002 admin. CRUD the catalogue of document
 * types: code, name, which subject types they apply to, and the mandatory /
 * expiry-required / verification-required / enabled flags. A row is blocked from
 * saving until it has a code and a name. A failed load shows the saved-info
 * badge and never fabricates an empty catalogue. Delete goes through
 * ConfirmDialog.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getDocumentTypes,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  SUBJECT_TYPES,
  SUBJECT_TYPE_LABELS,
  type DocumentType,
  type SubjectType,
  type DmSource,
} from "@/lib/crm/documents";

const inputStyle = { padding: 6, minHeight: 36, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

interface Row extends DocumentType {
  key: string;
}
let SEQ = 0;
function toRow(t: DocumentType): Row {
  return { ...t, key: t.id ?? `new-${SEQ++}` };
}
function blank(): DocumentType {
  return { code: "", name: "", appliesTo: [], mandatory: false, expiryRequired: false, verificationRequired: false, enabled: true };
}

export function DocumentTypesEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<DmSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getDocumentTypes();
    if (!isLive()) return;
    setRows(data.map(toRow));
    setSource(s);
  }
  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, []);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function toggleApplies(key: string, st: SubjectType) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const has = r.appliesTo.includes(st);
        return { ...r, appliesTo: has ? r.appliesTo.filter((x) => x !== st) : [...r.appliesTo, st] };
      }),
    );
  }
  function addRow() {
    setRows((prev) => [...prev, toRow(blank())]);
  }
  function rowValid(row: Row): boolean {
    return row.code.trim().length > 0 && row.name.trim().length > 0;
  }

  async function save(row: Row) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      setError(`Document type “${row.name || row.code || "(new)"}” needs a code and a name.`);
      return;
    }
    const payload: DocumentType = {
      ...(row.id ? { id: row.id } : {}),
      code: row.code.trim(),
      name: row.name.trim(),
      appliesTo: row.appliesTo,
      mandatory: row.mandatory,
      expiryRequired: row.expiryRequired,
      verificationRequired: row.verificationRequired,
      enabled: row.enabled,
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateDocumentType(row.id, payload);
      else await createDocumentType(payload);
      setMessage(`Document type “${payload.name}” saved.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the document type.");
    } finally {
      setBusyKey(null);
    }
  }

  async function doDelete(row: Row) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    setBusyKey(row.key);
    setError("");
    try {
      await deleteDocumentType(row.id);
      setMessage(`Document type “${row.name}” deleted.`);
      setConfirmKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the document type.");
    } finally {
      setBusyKey(null);
    }
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Document types</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 14 }}>
        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}

        {source === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Loading document types…</p>
        ) : source === "error" ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            — Document types unavailable right now. <DataSourceBadge source="error" />
          </p>
        ) : rows.length === 0 ? (
          <EmptyState icon="🗂️" title="No document types yet" message="Add the first document type below." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }} aria-label="Document types">
            {rows.map((row) => (
              <li key={row.key} className="card" style={{ padding: 12, boxShadow: "none", border: "1px solid var(--line)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Code</span>
                    <input value={row.code} onChange={(e) => update(row.key, { code: e.target.value })} style={inputStyle} aria-label="Document type code" />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Name</span>
                    <input value={row.name} onChange={(e) => update(row.key, { name: e.target.value })} style={inputStyle} aria-label="Document type name" />
                  </label>
                </div>
                <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, margin: "10px 0 0", padding: "6px 10px 10px" }}>
                  <legend style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, padding: "0 4px" }}>Applies to</legend>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {SUBJECT_TYPES.map((st) => (
                      <label key={st} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                        <input type="checkbox" checked={row.appliesTo.includes(st)} onChange={() => toggleApplies(row.key, st)} />
                        {SUBJECT_TYPE_LABELS[st]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                    <input type="checkbox" checked={row.mandatory} onChange={(e) => update(row.key, { mandatory: e.target.checked })} />
                    Mandatory
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                    <input type="checkbox" checked={row.expiryRequired} onChange={(e) => update(row.key, { expiryRequired: e.target.checked })} />
                    Expiry required
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                    <input type="checkbox" checked={row.verificationRequired} onChange={(e) => update(row.key, { verificationRequired: e.target.checked })} />
                    Verification required
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                    <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} />
                    Enabled
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn primary" style={{ minHeight: 40 }} disabled={busyKey === row.key || !rowValid(row)} onClick={() => save(row)}>
                    {busyKey === row.key ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="btn danger" style={{ minHeight: 40 }} disabled={busyKey === row.key} onClick={() => setConfirmKey(row.key)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {source !== "error" && source !== "loading" ? (
          <div>
            <button type="button" className="btn ghost" style={{ minHeight: 40 }} onClick={addRow}>
              + Add document type
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmKey !== null}
        title="Delete this document type?"
        description={confirmRow ? `“${confirmRow.name || confirmRow.code}” will no longer be selectable for new uploads.` : ""}
        confirmLabel="Delete"
        danger
        busy={busyKey === confirmKey}
        onConfirm={() => confirmRow && doDelete(confirmRow)}
        onCancel={() => setConfirmKey(null)}
      />
    </div>
  );
}
