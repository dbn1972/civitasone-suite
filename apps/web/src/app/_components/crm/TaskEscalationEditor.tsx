"use client";
/**
 * TaskEscalationEditor — AC-005 (config). CRUD the rules that escalate a task
 * left overdue past a threshold to a manager. Each row needs a positive whole
 * threshold in minutes and a manager (role or specific user), so an invalid row
 * is blocked from saving. Rows are created (POST), updated (PUT) or deleted
 * (DELETE, governed via ConfirmDialog) individually. A failed load shows the
 * saved-info badge, never an empty rule-set presented as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getTaskEscalationRules,
  createTaskEscalationRule,
  updateTaskEscalationRule,
  deleteTaskEscalationRule,
  type TaskEscalationRule,
  type AaSource,
} from "@/lib/crm/activityAccount";

interface Row extends TaskEscalationRule {
  key: string;
}
let SEQ = 0;
function toRow(r: TaskEscalationRule): Row {
  return { ...r, key: r.id ?? `new-${SEQ++}` };
}

function sanitizeInt(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : Number.NaN;
}
function rowValid(r: Row): boolean {
  return Number.isInteger(r.thresholdMinutes) && r.thresholdMinutes > 0 && (r.managerRole.trim().length > 0 || r.managerId.trim().length > 0);
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function TaskEscalationEditor() {
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getTaskEscalationRules();
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

  function addRule() {
    setRows((prev) => [...prev, toRow({ thresholdMinutes: 1440, managerRole: "", managerId: "", enabled: true })]);
  }

  async function saveRow(row: Row) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      setError("Each rule needs a positive threshold in minutes and a manager role or user.");
      return;
    }
    const rule: TaskEscalationRule = {
      ...(row.id ? { id: row.id } : {}),
      thresholdMinutes: row.thresholdMinutes,
      managerRole: row.managerRole.trim(),
      managerId: row.managerId.trim(),
      enabled: row.enabled,
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateTaskEscalationRule(row.id, rule);
      else await createTaskEscalationRule(rule);
      setMessage("Task-escalation rule saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the rule.");
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
      await deleteTaskEscalationRule(row.id);
      setMessage("Task-escalation rule deleted.");
      setConfirmKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the rule.");
    } finally {
      setBusyKey(null);
    }
  }

  if (source === "loading") {
    return <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>Loading task-escalation rules…</p>;
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Task escalation</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 12 }}>
        {rows.length === 0 ? (
          <EmptyState icon="⏰" title="No task-escalation rules yet" message="Add a rule so overdue tasks reach a manager." />
        ) : (
          rows.map((row, i) => (
            <fieldset key={row.key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "grid", gap: 10, margin: 0 }}>
              <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", padding: "0 6px" }}>Rule {i + 1}</legend>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label htmlFor={`${row.key}-th`} style={labelStyle}>Overdue by (minutes)</label>
                  <input
                    id={`${row.key}-th`}
                    aria-label={`Threshold minutes for rule ${i + 1}`}
                    type="number"
                    min={1}
                    value={Number.isNaN(row.thresholdMinutes) ? "" : row.thresholdMinutes}
                    onChange={(e) => update(row.key, { thresholdMinutes: sanitizeInt(e.target.value) })}
                    aria-invalid={rowValid(row) ? undefined : true}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label htmlFor={`${row.key}-mr`} style={labelStyle}>Manager role</label>
                  <input id={`${row.key}-mr`} aria-label={`Manager role for rule ${i + 1}`} value={row.managerRole} onChange={(e) => update(row.key, { managerRole: e.target.value })} placeholder="e.g. sales_manager" style={inputStyle} />
                </div>
                <div>
                  <label htmlFor={`${row.key}-mi`} style={labelStyle}>Manager user</label>
                  <input id={`${row.key}-mi`} aria-label={`Manager user for rule ${i + 1}`} value={row.managerId} onChange={(e) => update(row.key, { managerId: e.target.value })} placeholder="user id (optional)" style={inputStyle} />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={row.enabled} aria-label={`Enable rule ${i + 1}`} onChange={(e) => update(row.key, { enabled: e.target.checked })} />
                Enabled
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn primary" disabled={busyKey === row.key} onClick={() => void saveRow(row)} style={{ minHeight: 40 }}>
                  {busyKey === row.key ? "Saving…" : row.id ? "Save" : "Create"}
                </button>
                <button type="button" className="btn danger" aria-label={`Delete rule ${i + 1}`} disabled={busyKey === row.key} onClick={() => setConfirmKey(row.key)} style={{ minHeight: 40 }}>
                  Delete
                </button>
              </div>
            </fieldset>
          ))
        )}
        <div>
          <button type="button" className="btn" onClick={addRule} style={{ minHeight: 44 }}>+ Add task-escalation rule</button>
        </div>
        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        title="Delete this task-escalation rule?"
        description="Overdue tasks will no longer escalate under this rule."
        confirmLabel="Delete rule"
        danger
        busy={busyKey !== null && confirmRow?.key === busyKey}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void confirmDelete(confirmRow)}
      />
    </div>
  );
}
