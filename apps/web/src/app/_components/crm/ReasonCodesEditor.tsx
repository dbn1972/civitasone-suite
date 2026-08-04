"use client";
/**
 * ReasonCodesEditor — LQ-004 admin. Manage the controlled list of lead
 * status-change reason codes surfaced by the transition picker. GET on mount,
 * PUT on save; a row needs a code before it can be persisted. On a failed load
 * we show the saved-info badge and never fabricate an empty list as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
import {
  getReasonCodes,
  saveReasonCodes,
  type LeadReasonCode,
  type LqSource,
} from "@/lib/crm/leadQualification";

const STATUS_OPTIONS = ["", "new", "contacted", "qualified", "unqualified", "disqualified", "customer"];
const cellInput = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" } as const;

export function ReasonCodesEditor() {
  const [codes, setCodes] = useState<LeadReasonCode[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();

  async function load() {
    setSource("loading");
    const { data, source: s } = await getReasonCodes();
    setCodes(data);
    setSource(s);
  }

  useEffect(() => { void load(); }, []);

  function update(idx: number, patch: Partial<LeadReasonCode>) {
    setCodes((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function addCode() {
    setCodes((prev) => [...prev, { code: "", label: "", appliesToStatus: "", active: true }]);
  }

  function removeCode(idx: number) {
    setCodes((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setMessage("");
    setError("");
    if (!codes.every((c) => c.code.trim().length > 0)) {
      setError("Every reason needs a code before it can be saved. Fix the highlighted rows.");
      return;
    }
    setBusy(true);
    try {
      await saveReasonCodes(codes);
      setMessage("Reason codes saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the reason codes.");
    } finally {
      setBusy(false);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading reason codes…
      </p>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Reason codes</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      {codes.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="No reason codes yet"
          message="Add reason codes so status changes (disqualify, re-open…) capture a consistent, auditable reason."
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Applies to status</th>
              <th>Active</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c, idx) => (
              <tr key={idx}>
                <td>
                  <label className="sr-only" htmlFor={`${headingId}-code-${idx}`}>Code for reason {idx + 1}</label>
                  <input
                    id={`${headingId}-code-${idx}`}
                    value={c.code}
                    aria-invalid={c.code.trim() ? undefined : true}
                    onChange={(e) => update(idx, { code: e.target.value.toUpperCase() })}
                    placeholder="e.g. NO_BUDGET"
                    style={cellInput}
                  />
                </td>
                <td>
                  <label className="sr-only" htmlFor={`${headingId}-label-${idx}`}>Label for reason {idx + 1}</label>
                  <input id={`${headingId}-label-${idx}`} value={c.label} onChange={(e) => update(idx, { label: e.target.value })} placeholder="No budget" style={cellInput} />
                </td>
                <td>
                  <label className="sr-only" htmlFor={`${headingId}-status-${idx}`}>Applies-to status for reason {idx + 1}</label>
                  <select id={`${headingId}-status-${idx}`} value={c.appliesToStatus} onChange={(e) => update(idx, { appliesToStatus: e.target.value })} style={cellInput}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === "" ? "Any status" : s}</option>)}
                  </select>
                </td>
                <td>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={c.active} onChange={(e) => update(idx, { active: e.target.checked })} aria-label={`Activate reason ${idx + 1}`} />
                    {c.active ? "On" : "Off"}
                  </label>
                </td>
                <td>
                  <button type="button" className="btn ghost sm" onClick={() => removeCode(idx)} aria-label={`Remove reason ${idx + 1}`}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <button type="button" className="btn ghost" onClick={addCode}>+ Add reason code</button>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save reason codes"}
        </button>
      </div>
    </div>
  );
}
