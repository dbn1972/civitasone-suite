"use client";
/**
 * LeadScoreRulesEditor — LQ-002 admin. View and edit the weighted scoring rules
 * that drive automatic lead scoring. GET on mount, PUT on save. Numbers are
 * NaN-guarded and params are validated as JSON; an invalid row blocks the save
 * (never PUT a NaN weight or malformed params). On a failed load we show the
 * saved-info badge and never fabricate an empty rule set as fact.
 */
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState } from "../ds";
import {
  getScoreRules,
  saveScoreRules,
  SCORE_FN_TYPES,
  type LeadScoreRule,
  type ScoreFnType,
  type LqSource,
} from "@/lib/crm/leadQualification";

/** Row state keeps params as raw text so a half-typed JSON never crashes state. */
interface RuleRow extends Omit<LeadScoreRule, "params"> {
  paramsText: string;
}

function toRow(r: LeadScoreRule): RuleRow {
  const { params, ...rest } = r;
  return { ...rest, paramsText: params && Object.keys(params).length > 0 ? JSON.stringify(params) : "" };
}

function sanitizeNumber(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Parse a params cell; empty → {}, otherwise must be a JSON object. */
function parseParams(text: string): Record<string, unknown> | null {
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
    row.attribute.trim().length > 0 &&
    Number.isFinite(row.weight) &&
    parseParams(row.paramsText) !== null
  );
}

export function LeadScoreRulesEditor() {
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();

  async function load() {
    setSource("loading");
    const { data, source: s } = await getScoreRules();
    setRows(data.map(toRow));
    setSource(s);
  }

  useEffect(() => { void load(); }, []);

  function update(idx: number, patch: Partial<RuleRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRule() {
    setRows((prev) => [...prev, { attribute: "", weight: 1, scoreFnType: "linear", enabled: true, paramsText: "" }]);
  }

  function removeRule(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setMessage("");
    setError("");
    if (!rows.every(rowValid)) {
      setError("Each rule needs an attribute, a numeric weight, and valid JSON params. Fix the highlighted rules before saving.");
      return;
    }
    setBusy(true);
    try {
      const rules: LeadScoreRule[] = rows.map((r) => {
        const { paramsText, ...rest } = r;
        return { ...rest, params: parseParams(paramsText) ?? {} };
      });
      await saveScoreRules(rules);
      setMessage("Scoring rules saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the scoring rules.");
    } finally {
      setBusy(false);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading scoring rules…
      </p>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Scoring rules</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="📊"
          title="No scoring rules yet"
          message="Add a rule to weight a lead attribute (industry, engagement, budget…) into the automatic score."
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Score function</th>
              <th style={{ textAlign: "right" }}>Weight</th>
              <th>Params (JSON)</th>
              <th>Enabled</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const paramsOk = parseParams(row.paramsText) !== null;
              return (
                <tr key={idx}>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-attr-${idx}`}>Attribute for rule {idx + 1}</label>
                    <input
                      id={`${headingId}-attr-${idx}`}
                      value={row.attribute}
                      aria-invalid={row.attribute.trim() ? undefined : true}
                      onChange={(e) => update(idx, { attribute: e.target.value })}
                      placeholder="e.g. industry"
                      style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                    />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-fn-${idx}`}>Score function for rule {idx + 1}</label>
                    <select
                      id={`${headingId}-fn-${idx}`}
                      value={row.scoreFnType}
                      onChange={(e) => update(idx, { scoreFnType: e.target.value as ScoreFnType })}
                      style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                    >
                      {SCORE_FN_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`${headingId}-weight-${idx}`}>Weight for rule {idx + 1}</label>
                    <input
                      id={`${headingId}-weight-${idx}`}
                      type="number" step={0.1}
                      value={Number.isFinite(row.weight) ? row.weight : ""}
                      aria-invalid={Number.isFinite(row.weight) ? undefined : true}
                      onChange={(e) => update(idx, { weight: sanitizeNumber(e.target.value) })}
                      style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-params-${idx}`}>Params JSON for rule {idx + 1}</label>
                    <input
                      id={`${headingId}-params-${idx}`}
                      value={row.paramsText}
                      aria-invalid={paramsOk ? undefined : true}
                      onChange={(e) => update(idx, { paramsText: e.target.value })}
                      placeholder='{"max":100}'
                      style={{ minWidth: 160, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                    />
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })} aria-label={`Enable rule ${idx + 1}`} />
                      {row.enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td>
                    <button type="button" className="btn ghost sm" onClick={() => removeRule(idx)} aria-label={`Remove rule ${idx + 1}`}>Remove</button>
                  </td>
                </tr>
              );
            })}
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
