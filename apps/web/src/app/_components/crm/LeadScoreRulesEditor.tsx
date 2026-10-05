"use client";
/**
 * LeadScoreRulesEditor — LQ-002 admin. View and edit the weighted scoring rules
 * that drive automatic lead scoring. GET on mount, PUT on save. Numbers are
 * NaN-guarded and params are validated; an invalid row blocks the save (never
 * PUT a NaN weight or malformed params). On a failed load we show a recoverable
 * ErrorState (never the editor) so an errored load can never be saved back as an
 * empty rule set — saving {rules:[]} from a failed load would switch off
 * automatic scoring for every lead. We never fabricate an empty rule set as fact.
 *
 * GAP-CRM-LEAD-SCORING-02 (params contract): the score-function select offers
 * the real crm-service kinds (presence/map/recency/numeric_threshold — the old
 * linear/step/boolean the backend never accepted) with a human label and a
 * worked example under it, and params are validated against the exact shape
 * buildScoreFn reads, with a per-row message.
 *
 * GAP-CRM-LEAD-SCORING-03 (attribute): the attribute input is backed by a
 * datalist of the known default-rule lead fields and warns on an unrecognised
 * attribute (the backend column is free varchar, so a custom field is allowed —
 * we warn, not block).
 *
 * GAP-CRM-LEAD-SCORING-04 (weights): a running weight total and each rule's
 * share % are shown, and Save opens a confirm making it explicit that the change
 * re-scores every lead. A backend dry-run score-distribution preview is deferred
 * (no endpoint); recorded in the fixer report.
 *
 * GAP-CRM-LEAD-SCORING-05 (concurrency): the backend GET now returns a
 * list-level version (SUM of per-row versions) plus "Last changed by/at", and
 * the PUT requires that version as If-Match. The editor stores the version,
 * sends it on save, and on a 409 shows "changed by another admin — reload"
 * instead of silently clobbering a concurrent admin's change (wave2 backend).
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button, ErrorState } from "../ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDateTime } from "@/lib/formatters";
import {
  getScoreRules,
  saveScoreRules,
  validateScoreFnParams,
  ConfigConflictError,
  SCORE_FN_TYPES,
  SCORE_FN_LABELS,
  SCORE_FN_PARAM_HINTS,
  DEFAULT_SCORE_ATTRIBUTES,
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

/**
 * services/crm-service leads/score-rules-validators.ts requires weight to be
 * z.number().int().min(0).max(100) -- round + clamp here so a partial or
 * fractional entry never lands something the backend rejects.
 */
function sanitizeNumber(raw: string): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.min(100, Math.max(0, n));
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

/** Params error for a row: JSON-shape first, then the fn-type-specific contract. */
function paramsError(row: RuleRow, t: ReturnType<typeof useTranslations>): string | null {
  const parsed = parseParams(row.paramsText);
  if (parsed === null) return t("paramsMustBeObject");
  return validateScoreFnParams(row.scoreFnType, parsed);
}

function rowValid(row: RuleRow, t: ReturnType<typeof useTranslations>): boolean {
  return (
    row.attribute.trim().length > 0 &&
    Number.isInteger(row.weight) &&
    row.weight >= 0 &&
    row.weight <= 100 &&
    paramsError(row, t) === null
  );
}

export function LeadScoreRulesEditor() {
  const t = useTranslations("crmLeadScoreRulesEditor");
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);
  // GAP-CRM-LEAD-SCORING-05: list-level optimistic-concurrency token +
  // "Last changed by/at" from the GET metadata.
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [lastChangedBy, setLastChangedBy] = useState<string | undefined>(undefined);
  const [lastChangedAt, setLastChangedAt] = useState<string | undefined>(undefined);
  const headingId = useId();
  const attrListId = useId();

  const nextRuleRowId = useRef(0);
  const [ruleRowIds, setRuleRowIds] = useState<number[]>([]);
  const ruleKeyFor = (idx: number) => ruleRowIds[idx] ?? idx;

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s, meta } = await getScoreRules();
    if (!isLive()) return;
    const nextRows = data.map(toRow);
    setRows(nextRows);
    setRuleRowIds(nextRows.map(() => nextRuleRowId.current++));
    setVersion(meta?.version);
    setLastChangedBy(meta?.updatedBy);
    setLastChangedAt(meta?.updatedAt);
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, []);

  function update(idx: number, patch: Partial<RuleRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRule() {
    setRows((prev) => [...prev, { attribute: "", weight: 1, scoreFnType: "presence", enabled: true, paramsText: "" }]);
    setRuleRowIds((ids) => [...ids, nextRuleRowId.current++]);
  }

  function removeRule(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setRuleRowIds((ids) => ids.filter((_, i) => i !== idx));
  }

  // Running total of enabled weights, used for the total + per-rule share %.
  const enabledWeightTotal = rows.reduce((sum, r) => sum + (r.enabled && Number.isFinite(r.weight) ? r.weight : 0), 0);

  async function persist() {
    setBusy(true);
    try {
      const rules: LeadScoreRule[] = rows.map((r) => {
        const { paramsText, ...rest } = r;
        return { ...rest, params: parseParams(paramsText) ?? {} };
      });
      const newVersion = await saveScoreRules(rules, version);
      if (newVersion) setVersion(newVersion);
      setMessage("Scoring rules saved.");
    } catch (e) {
      if (e instanceof ConfigConflictError) {
        setError(t("conflictChanged"));
      } else {
        setError(e instanceof Error ? e.message : t("couldNotSave"));
      }
    } finally {
      setBusy(false);
    }
  }

  function save() {
    setMessage("");
    setError("");
    if (!rows.every((r) => rowValid(r, t))) {
      setError(t("ruleNeedsFields"));
      return;
    }
    // GAP-CRM-LEAD-SCORING-04: changing weights re-scores every lead, so make
    // that explicit before the PUT.
    setConfirmSave(true);
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading scoring rules…
      </p>
    );
  }

  if (source === "error") {
    return (
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>{t("heading")}</h3>
          <DataSourceBadge source="error" />
        </div>
        <ErrorState error={toHumanError("load", { area: "scoring rules" })} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Scoring rules</h3>
      </div>
      {lastChangedAt ? (
        <p style={{ fontSize: 12, color: "var(--muted)", padding: "0 12px" }}>
          {lastChangedBy
            ? t("lastChangedAtBy", { at: formatIndianDateTime(lastChangedAt), by: lastChangedBy })
            : t("lastChangedAt", { at: formatIndianDateTime(lastChangedAt) })}
        </p>
      ) : null}
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      <datalist id={attrListId}>
        {DEFAULT_SCORE_ATTRIBUTES.map((a) => <option key={a} value={a} />)}
      </datalist>

      {rows.length === 0 ? (
        <EmptyState
          icon="📊"
          title="No scoring rules yet"
          message={t("emptyMessage")}
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>Attribute</th>
              <th>Score function</th>
              <th style={{ textAlign: "end" }}>Weight</th>
              <th style={{ textAlign: "end" }}>{t("share")}</th>
              <th>Params (JSON)</th>
              <th>Enabled</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const pErr = paramsError(row, t);
              const unknownAttr = row.attribute.trim().length > 0 && !(DEFAULT_SCORE_ATTRIBUTES as readonly string[]).includes(row.attribute.trim());
              const share = row.enabled && enabledWeightTotal > 0 && Number.isFinite(row.weight)
                ? Math.round((row.weight / enabledWeightTotal) * 100)
                : 0;
              return (
                <tr key={ruleKeyFor(idx)}>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-attr-${idx}`}>Attribute for rule {idx + 1}</label>
                    <input
                      id={`${headingId}-attr-${idx}`}
                      list={attrListId}
                      value={row.attribute}
                      aria-invalid={row.attribute.trim() ? undefined : true}
                      onChange={(e) => update(idx, { attribute: e.target.value })}
                      placeholder={t("attributePlaceholder")}
                      style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                    />
                    {unknownAttr ? (
                      <span style={{ display: "block", fontSize: 11, color: "#b45309" }}>
                        {t("unknownAttribute")}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-fn-${idx}`}>Score function for rule {idx + 1}</label>
                    <select
                      id={`${headingId}-fn-${idx}`}
                      value={row.scoreFnType}
                      onChange={(e) => update(idx, { scoreFnType: e.target.value as ScoreFnType })}
                      style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                    >
                      {SCORE_FN_TYPES.map((f) => <option key={f} value={f}>{SCORE_FN_LABELS[f]}</option>)}
                    </select>
                    <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                      {t("exampleHint", { hint: SCORE_FN_PARAM_HINTS[row.scoreFnType] })}
                    </span>
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`${headingId}-weight-${idx}`}>Weight for rule {idx + 1}</label>
                    <input
                      id={`${headingId}-weight-${idx}`}
                      type="number" min={0} max={100} step={1}
                      value={Number.isFinite(row.weight) ? row.weight : ""}
                      aria-invalid={Number.isFinite(row.weight) ? undefined : true}
                      onChange={(e) => update(idx, { weight: sanitizeNumber(e.target.value) })}
                      style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "end" }}
                    />
                  </td>
                  <td className="num" style={{ fontSize: 12, color: "var(--muted)" }} aria-label={t("shareForRule", { n: idx + 1 })}>
                    {row.enabled ? `${share}%` : "—"}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-params-${idx}`}>Params JSON for rule {idx + 1}</label>
                    <input
                      id={`${headingId}-params-${idx}`}
                      value={row.paramsText}
                      aria-invalid={pErr ? true : undefined}
                      onChange={(e) => update(idx, { paramsText: e.target.value })}
                      placeholder={SCORE_FN_PARAM_HINTS[row.scoreFnType]}
                      style={{ minWidth: 220, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                    />
                    {pErr ? <span style={{ display: "block", fontSize: 11, color: "#b42318" }}>{pErr}</span> : null}
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })} aria-label={`Enable rule ${idx + 1}`} />
                      {row.enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeRule(idx)} aria-label={`Remove rule ${idx + 1}`}>Remove</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ textAlign: "end", fontWeight: 600 }}>{t("totalEnabledWeight")}</td>
              <td className="num" style={{ fontWeight: 700 }} aria-label={t("totalEnabledWeight")}>{enabledWeightTotal}</td>
              <td colSpan={4} style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("weightsNormalised")}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <Button type="button" variant="ghost" onClick={addRule}>+ Add rule</Button>
        <Button type="button" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save rules"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmSave}
        title={t("confirmTitle")}
        description={t("confirmDescription")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        onCancel={() => setConfirmSave(false)}
        onConfirm={() => {
          setConfirmSave(false);
          void persist();
        }}
      />
    </div>
  );
}
