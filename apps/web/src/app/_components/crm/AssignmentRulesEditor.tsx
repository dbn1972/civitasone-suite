"use client";
/**
 * AssignmentRulesEditor — AS-001 admin. CRUD the ordered rule chain that routes
 * new leads to owners. Each row is created (POST), updated (PUT) or deleted
 * (DELETE) individually per the contract. `criteria` is edited as raw JSON and
 * validated before save — an invalid row is blocked, never POSTed. Deletion is
 * governed, so it goes through a ConfirmDialog. On a failed load we show the
 * saved-info badge and never fabricate an empty chain as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../ds";
import {
  getAssignmentRules,
  createAssignmentRule,
  updateAssignmentRule,
  deleteAssignmentRule,
  RULE_TYPES,
  RULE_TYPE_LABELS,
  type AssignmentRule,
  type RuleType,
  type AsSource,
} from "@/lib/crm/assignment";

/** Row state keeps criteria as raw text so a half-typed JSON never crashes state. */
interface RuleRow extends Omit<AssignmentRule, "criteria"> {
  /** Stable local key for React (id when persisted, else a synthetic key). */
  key: string;
  criteriaText: string;
}

let SEQ = 0;
function toRow(r: AssignmentRule): RuleRow {
  const { criteria, ...rest } = r;
  return {
    ...rest,
    key: r.id ?? `new-${SEQ++}`,
    criteriaText: criteria && Object.keys(criteria).length > 0 ? JSON.stringify(criteria) : "",
  };
}

function sanitizeInt(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
}

/** Parse a criteria cell; empty → {}, otherwise must be a JSON object. */
function parseCriteria(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t) return {};
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function rowValid(row: RuleRow): boolean {
  return (
    row.name.trim().length > 0 &&
    Number.isInteger(row.ordinal) &&
    row.ordinal >= 0 &&
    parseCriteria(row.criteriaText) !== null
  );
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

export function AssignmentRulesEditor() {
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getAssignmentRules();
    if (!isLive()) return;
    setRows(data.map(toRow));
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, []);

  function update(key: string, patch: Partial<RuleRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRule() {
    setRows((prev) => [
      ...prev,
      toRow({ name: "", ruleType: "territory", criteria: {}, ordinal: prev.length, enabled: true, fallbackOwnerId: "" }),
    ]);
  }

  async function saveRow(row: RuleRow) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      setError(`Rule “${row.name || "(unnamed)"}” needs a name, a whole-number order and valid JSON criteria.`);
      return;
    }
    const rule: AssignmentRule = {
      ...(row.id ? { id: row.id } : {}),
      name: row.name.trim(),
      ruleType: row.ruleType,
      criteria: parseCriteria(row.criteriaText) ?? {},
      ordinal: row.ordinal,
      enabled: row.enabled,
      fallbackOwnerId: row.fallbackOwnerId.trim(),
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateAssignmentRule(row.id, rule);
      else await createAssignmentRule(rule);
      setMessage(`Rule “${rule.name}” saved.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the rule.");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmDelete(row: RuleRow) {
    // Unsaved rows are dropped locally without a round-trip.
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setConfirmKey(null);
      return;
    }
    setBusyKey(row.key);
    setError("");
    try {
      await deleteAssignmentRule(row.id);
      setMessage(`Rule “${row.name}” deleted.`);
      setConfirmKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the rule.");
    } finally {
      setBusyKey(null);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading assignment rules…
      </p>
    );
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Assignment rules</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="No assignment rules yet"
          message="Add a rule to route new leads by territory, round-robin, score, product, segment, language or capacity."
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th style={{ width: 70 }}>Order</th>
              <th>Name</th>
              <th>Strategy</th>
              <th>Criteria (JSON)</th>
              <th>Fallback owner</th>
              <th>Enabled</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice()
              .sort((a, b) => a.ordinal - b.ordinal)
              .map((row, i) => {
                // n follows the visible (ordinal-sorted) row position so sr-only
                // labels match what the user sees, not the unsorted source order.
                const n = i + 1;
                const criteriaOk = parseCriteria(row.criteriaText) !== null;
                const busy = busyKey === row.key;
                return (
                  <tr key={row.key}>
                    <td className="num">
                      <label className="sr-only" htmlFor={`${headingId}-ord-${row.key}`}>Order for rule {n}</label>
                      <input
                        id={`${headingId}-ord-${row.key}`}
                        type="number" min={0} step={1}
                        value={Number.isInteger(row.ordinal) ? row.ordinal : ""}
                        aria-invalid={Number.isInteger(row.ordinal) ? undefined : true}
                        onChange={(e) => update(row.key, { ordinal: sanitizeInt(e.target.value) })}
                        style={{ ...inputStyle, width: 60, textAlign: "right" }}
                      />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-name-${row.key}`}>Name for rule {n}</label>
                      <input
                        id={`${headingId}-name-${row.key}`}
                        value={row.name}
                        aria-invalid={row.name.trim() ? undefined : true}
                        onChange={(e) => update(row.key, { name: e.target.value })}
                        placeholder="e.g. West-zone reps"
                        style={inputStyle}
                      />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-type-${row.key}`}>Strategy for rule {n}</label>
                      <select
                        id={`${headingId}-type-${row.key}`}
                        value={row.ruleType}
                        onChange={(e) => update(row.key, { ruleType: e.target.value as RuleType })}
                        style={inputStyle}
                      >
                        {RULE_TYPES.map((t) => <option key={t} value={t}>{RULE_TYPE_LABELS[t]}</option>)}
                      </select>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-crit-${row.key}`}>Criteria JSON for rule {n}</label>
                      <input
                        id={`${headingId}-crit-${row.key}`}
                        value={row.criteriaText}
                        aria-invalid={criteriaOk ? undefined : true}
                        onChange={(e) => update(row.key, { criteriaText: e.target.value })}
                        placeholder='{"region":"west"}'
                        style={{ ...inputStyle, minWidth: 160 }}
                      />
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-fb-${row.key}`}>Fallback owner for rule {n}</label>
                      <input
                        id={`${headingId}-fb-${row.key}`}
                        value={row.fallbackOwnerId}
                        onChange={(e) => update(row.key, { fallbackOwnerId: e.target.value })}
                        placeholder="owner id"
                        style={inputStyle}
                      />
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
        <button type="button" className="btn ghost" onClick={addRule}>+ Add rule</button>
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        danger
        title={confirmRow ? `Delete rule “${confirmRow.name || "(unnamed)"}”?` : ""}
        description="Leads will stop routing through this rule. This cannot be undone."
        confirmLabel="Delete rule"
        busy={confirmRow ? busyKey === confirmRow.key : false}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void confirmDelete(confirmRow)}
      />
    </div>
  );
}
