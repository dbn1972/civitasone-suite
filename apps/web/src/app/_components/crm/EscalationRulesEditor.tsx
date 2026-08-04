"use client";
/**
 * EscalationRulesEditor — AS-004 admin. CRUD the rules that escalate leads which
 * sit unaccepted or unattended past a threshold. Each row is created (POST),
 * updated (PUT) or deleted (DELETE) individually. Threshold is minute-guarded
 * (a positive whole number) and a recipient (role or user) is required, so an
 * invalid row is blocked. Deletion is governed via ConfirmDialog. On a failed
 * load we show the saved-info badge and never fabricate an empty set as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getEscalationRules,
  createEscalationRule,
  updateEscalationRule,
  deleteEscalationRule,
  ESCALATION_TRIGGERS,
  ESCALATION_TRIGGER_LABELS,
  type EscalationRule,
  type EscalationTrigger,
  type AsSource,
} from "@/lib/crm/assignment";

interface Row extends EscalationRule {
  key: string;
}
let SEQ = 0;
function toRow(r: EscalationRule): Row {
  return { ...r, key: r.id ?? `new-${SEQ++}` };
}

function sanitizeInt(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : Number.NaN;
}

function rowValid(row: Row): boolean {
  return (
    Number.isInteger(row.thresholdMinutes) &&
    row.thresholdMinutes > 0 &&
    (row.recipientRole.trim().length > 0 || row.recipientId.trim().length > 0)
  );
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

export function EscalationRulesEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getEscalationRules();
    if (!isLive()) return;
    setRows(data.map(toRow));
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, []);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRule() {
    setRows((prev) => [
      ...prev,
      toRow({ trigger: "unaccepted", thresholdMinutes: 60, recipientRole: "", recipientId: "", reassign: false, enabled: true }),
    ]);
  }

  async function saveRow(row: Row) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      setError("Each rule needs a positive threshold in minutes and a recipient role or user.");
      return;
    }
    const rule: EscalationRule = {
      ...(row.id ? { id: row.id } : {}),
      trigger: row.trigger,
      thresholdMinutes: row.thresholdMinutes,
      recipientRole: row.recipientRole.trim(),
      recipientId: row.recipientId.trim(),
      reassign: row.reassign,
      enabled: row.enabled,
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateEscalationRule(row.id, rule);
      else await createEscalationRule(rule);
      setMessage("Escalation rule saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the escalation rule.");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmDelete(row: Row) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    setBusyKey(row.key);
    setError("");
    try {
      await deleteEscalationRule(row.id);
      setMessage("Escalation rule deleted.");
      setConfirmKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the escalation rule.");
    } finally {
      setBusyKey(null);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading escalation rules…
      </p>
    );
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Escalation rules</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="⏰"
          title="No escalation rules yet"
          message="Add a rule to escalate leads that sit unaccepted or unattended beyond a time threshold."
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Trigger</th>
              <th style={{ textAlign: "right" }}>Threshold (min)</th>
              <th>Recipient role</th>
              <th>Recipient user</th>
              <th>Reassign</th>
              <th>Enabled</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const n = i + 1;
              const busy = busyKey === row.key;
              const threshOk = Number.isInteger(row.thresholdMinutes) && row.thresholdMinutes > 0;
              return (
                <tr key={row.key}>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-trig-${row.key}`}>Trigger for rule {n}</label>
                    <select
                      id={`${headingId}-trig-${row.key}`}
                      value={row.trigger}
                      onChange={(e) => update(row.key, { trigger: e.target.value as EscalationTrigger })}
                      style={inputStyle}
                    >
                      {ESCALATION_TRIGGERS.map((t) => <option key={t} value={t}>{ESCALATION_TRIGGER_LABELS[t]}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`${headingId}-th-${row.key}`}>Threshold minutes for rule {n}</label>
                    <input
                      id={`${headingId}-th-${row.key}`}
                      type="number" min={1} step={1}
                      value={Number.isInteger(row.thresholdMinutes) ? row.thresholdMinutes : ""}
                      aria-invalid={threshOk ? undefined : true}
                      onChange={(e) => update(row.key, { thresholdMinutes: sanitizeInt(e.target.value) })}
                      style={{ ...inputStyle, width: 90, textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-role-${row.key}`}>Recipient role for rule {n}</label>
                    <input id={`${headingId}-role-${row.key}`} value={row.recipientRole} onChange={(e) => update(row.key, { recipientRole: e.target.value })} placeholder="e.g. sales_manager" style={inputStyle} />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-uid-${row.key}`}>Recipient user for rule {n}</label>
                    <input id={`${headingId}-uid-${row.key}`} value={row.recipientId} onChange={(e) => update(row.key, { recipientId: e.target.value })} placeholder="user id (optional)" style={inputStyle} />
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.reassign} onChange={(e) => update(row.key, { reassign: e.target.checked })} aria-label={`Reassign on escalation for rule ${n}`} />
                      {row.reassign ? "Yes" : "No"}
                    </label>
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} aria-label={`Enable rule ${n}`} />
                      {row.enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="btn primary sm" onClick={() => void saveRow(row)} disabled={busy}>
                        {busy ? "…" : row.id ? "Save" : "Create"}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete rule ${n}`}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <button type="button" className="btn ghost" onClick={addRule}>+ Add escalation rule</button>
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        danger
        title="Delete escalation rule?"
        description="Leads will no longer escalate under this rule. This cannot be undone."
        confirmLabel="Delete rule"
        busy={confirmRow ? busyKey === confirmRow.key : false}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void confirmDelete(confirmRow)}
      />
    </div>
  );
}
