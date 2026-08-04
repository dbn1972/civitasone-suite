"use client";
/**
 * DedupRulesEditor — DQ-001 admin. View and edit the configurable matching
 * rules that drive duplicate detection. GET on mount, PUT on save. Stats/rows
 * follow the source==="error" pattern: on a failed load we show the saved-info
 * badge and never fabricate an empty rule set as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
import {
  getDedupRules,
  saveDedupRules,
  type DedupRule,
  type DedupField,
  type DedupMatchType,
  type DqSource,
} from "@/lib/crm/dataQuality";

const FIELD_OPTIONS: DedupField[] = ["email", "phone", "gstin", "pan", "name", "company"];
const MATCH_OPTIONS: DedupMatchType[] = ["exact", "fuzzy"];

/**
 * Coerce a numeric-input string to a finite, non-negative number so a partial
 * or invalid entry ("", "-", "abc") never lands NaN in state and gets PUT.
 */
function sanitizeNumber(raw: string, opts: { max?: number } = {}): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (opts.max !== undefined && n > opts.max) return opts.max;
  return n;
}

/** True when a rule's weight/threshold are safe to persist. */
function ruleNumbersValid(rule: DedupRule): boolean {
  return (
    Number.isFinite(rule.weight) &&
    rule.weight >= 0 &&
    Number.isFinite(rule.threshold) &&
    rule.threshold >= 0
  );
}

export function DedupRulesEditor() {
  const [rules, setRules] = useState<DedupRule[]>([]);
  const [source, setSource] = useState<DqSource | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();

  async function load() {
    setSource("loading");
    const { data, source: s } = await getDedupRules();
    setRules(data);
    setSource(s);
  }

  useEffect(() => {
    void load();
  }, []);

  function update(idx: number, patch: Partial<DedupRule>) {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRule() {
    setRules((prev) => [
      ...prev,
      { field: "email", matchType: "exact", weight: 1, threshold: 0.9, enabled: true },
    ]);
  }

  function removeRule(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setMessage("");
    setError("");
    if (!rules.every(ruleNumbersValid)) {
      setError("Weight and threshold must be valid numbers (0 or more). Fix the highlighted rules before saving.");
      return;
    }
    setBusy(true);
    try {
      await saveDedupRules(rules);
      setMessage("Matching rules saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the matching rules.");
    } finally {
      setBusy(false);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading matching rules…
      </p>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Matching rules</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="No matching rules yet"
          message="Add a rule to tell the system which fields identify a duplicate and how strictly to compare them."
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Match type</th>
              <th style={{ textAlign: "right" }}>Weight</th>
              <th style={{ textAlign: "right" }}>Threshold</th>
              <th>Enabled</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, idx) => (
              <tr key={idx}>
                <td>
                  <label className="sr-only" htmlFor={`${headingId}-field-${idx}`}>Field for rule {idx + 1}</label>
                  <select
                    id={`${headingId}-field-${idx}`}
                    value={rule.field}
                    onChange={(e) => update(idx, { field: e.target.value as DedupField })}
                    style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                  >
                    {FIELD_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </td>
                <td>
                  <label className="sr-only" htmlFor={`${headingId}-match-${idx}`}>Match type for rule {idx + 1}</label>
                  <select
                    id={`${headingId}-match-${idx}`}
                    value={rule.matchType}
                    onChange={(e) => update(idx, { matchType: e.target.value as DedupMatchType })}
                    style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                  >
                    {MATCH_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </td>
                <td className="num">
                  <label className="sr-only" htmlFor={`${headingId}-weight-${idx}`}>Weight for rule {idx + 1}</label>
                  <input
                    id={`${headingId}-weight-${idx}`}
                    type="number" min={0} step={0.1}
                    value={Number.isFinite(rule.weight) ? rule.weight : ""}
                    aria-invalid={Number.isFinite(rule.weight) ? undefined : true}
                    onChange={(e) => update(idx, { weight: sanitizeNumber(e.target.value) })}
                    style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "right" }}
                  />
                </td>
                <td className="num">
                  <label className="sr-only" htmlFor={`${headingId}-threshold-${idx}`}>Threshold for rule {idx + 1}</label>
                  <input
                    id={`${headingId}-threshold-${idx}`}
                    type="number" min={0} max={1} step={0.05}
                    value={Number.isFinite(rule.threshold) ? rule.threshold : ""}
                    aria-invalid={Number.isFinite(rule.threshold) ? undefined : true}
                    onChange={(e) => update(idx, { threshold: sanitizeNumber(e.target.value, { max: 1 }) })}
                    style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "right" }}
                  />
                </td>
                <td>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => update(idx, { enabled: e.target.checked })}
                      aria-label={`Enable rule ${idx + 1}`}
                    />
                    {rule.enabled ? "On" : "Off"}
                  </label>
                </td>
                <td>
                  <button type="button" className="btn ghost sm" onClick={() => removeRule(idx)} aria-label={`Remove rule ${idx + 1}`}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <button type="button" className="btn ghost" onClick={addRule}>+ Add rule</button>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save rules"}
        </button>
      </div>
    </div>
  );
}
