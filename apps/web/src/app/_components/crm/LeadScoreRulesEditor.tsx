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
 * the real crm-service kinds (presence/map/recency/numeric_threshold). Each kind
 * gets a STRUCTURED form for its params (ScoreParamsEditor: presence scores, a
 * value -> score table, or tier rows) with a per-field inline error, validated
 * against the exact shape buildScoreFn reads (lib/crm/leadScoreParams.ts). The raw
 * JSON box remains as an "Edit as JSON" fallback (and is used automatically for
 * stored params the form cannot represent without losing information).
 *
 * GAP-CRM-LEAD-SCORING-03 (attribute): the attribute is a SELECT of the lead
 * fields the scorer actually evaluates (advertised by the backend in the GET meta,
 * with the built-in list as fallback) -- a typo is impossible, and a stored rule on
 * any other attribute is flagged and BLOCKS the save (the backend rejects it too).
 * Custom fields are not scoreable today (they are not part of the scoring input).
 *
 * GAP-CRM-LEAD-SCORING-04 (weights): a running weight total and each rule's
 * share % are shown, with the true scoring rule stated (weights are NOT
 * normalised: the weighted sum is divided by a fixed 100 and capped at 100, so
 * the enabled total sets the highest possible score). "Preview impact" dry-runs the
 * rules as edited against the tenant's leads (read-only) and shows how the score
 * distribution would move; Save still opens a confirm making it explicit that the
 * change re-scores every lead.
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
import { ScoreParamsEditor } from "./ScoreParamsEditor";
import { toHumanError } from "@/lib/messages";
import { formatIndianDateTime } from "@/lib/formatters";
import {
  getScoreRules,
  saveScoreRules,
  previewScoreRules,
  ConfigConflictError,
  SCORE_FN_TYPES,
  SCORE_FN_LABELS,
  SCORE_FN_PARAM_HINTS,
  SCOREABLE_LEAD_ATTRIBUTES,
  type LeadScoreRule,
  type ScoreFnType,
  type ScorePreview,
  type LqSource,
} from "@/lib/crm/leadQualification";
import {
  draftFromParams,
  draftIssues,
  emptyDraft,
  paramsFromDraft,
  paramsIssues,
  type ParamIssue,
  type ParamsDraft,
} from "@/lib/crm/leadScoreParams";

/**
 * Row state. While `advanced` is false the structured `draft` is the source of truth
 * for params; while true the raw `paramsText` is (so a half-typed JSON never crashes
 * state).
 */
interface RuleRow extends Omit<LeadScoreRule, "params"> {
  advanced: boolean;
  paramsText: string;
  draft: ParamsDraft;
  /** Set when "Use form" was refused because the JSON cannot be shown in the form. */
  formSwitchFailed?: boolean;
}

function paramsToText(params: Record<string, unknown>): string {
  return Object.keys(params).length > 0 ? JSON.stringify(params) : "";
}

function toRow(r: LeadScoreRule): RuleRow {
  const { params, ...rest } = r;
  const draft = draftFromParams(r.scoreFnType, params);
  return { ...rest, advanced: draft === null, paramsText: paramsToText(params), draft: draft ?? emptyDraft() };
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

interface ParamsState {
  /** The params object to save (null when the JSON box does not hold a JSON object). */
  params: Record<string, unknown> | null;
  /** Per-field issues (form) or per-key issues (JSON). */
  issues: ParamIssue[];
  /** Advanced mode only: the text is not a JSON object at all. */
  notObject: boolean;
}

function paramsState(row: RuleRow): ParamsState {
  if (row.advanced) {
    const parsed = parseParams(row.paramsText);
    if (parsed === null) return { params: null, issues: [], notObject: true };
    return { params: parsed, issues: paramsIssues(row.scoreFnType, parsed), notObject: false };
  }
  const issues = draftIssues(row.scoreFnType, row.draft);
  return { params: issues.length === 0 ? paramsFromDraft(row.scoreFnType, row.draft) : null, issues, notObject: false };
}

function rowValid(row: RuleRow, allowed: readonly string[], attributeCounts: Map<string, number>): boolean {
  const attr = row.attribute.trim();
  const ps = paramsState(row);
  return (
    attr.length > 0 &&
    allowed.includes(attr) &&
    (attributeCounts.get(attr) ?? 0) === 1 &&
    Number.isInteger(row.weight) &&
    row.weight >= 0 &&
    row.weight <= 100 &&
    !ps.notObject &&
    ps.issues.length === 0
  );
}

function toRules(rows: RuleRow[]): LeadScoreRule[] {
  return rows.map((r) => ({
    attribute: r.attribute.trim(),
    weight: r.weight,
    scoreFnType: r.scoreFnType,
    params: paramsState(r).params ?? {},
    enabled: r.enabled,
  }));
}

export function LeadScoreRulesEditor() {
  const t = useTranslations("crmLeadScoreRulesEditor");
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);
  // GAP-CRM-LEAD-SCORING-07: rules present at load, used to surface how many
  // rules a Save would drop (same diff pattern as REASON-CODES-02).
  const [originalRows, setOriginalRows] = useState<RuleRow[]>([]);
  // GAP-CRM-LEAD-SCORING-05: list-level optimistic-concurrency token +
  // "Last changed by/at" from the GET metadata.
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [lastChangedBy, setLastChangedBy] = useState<string | undefined>(undefined);
  const [lastChangedAt, setLastChangedAt] = useState<string | undefined>(undefined);
  // GAP-CRM-LEAD-SCORING-03: the lead fields a rule may score on (backend-advertised).
  const [allowedAttributes, setAllowedAttributes] = useState<readonly string[]>(SCOREABLE_LEAD_ATTRIBUTES);
  // GAP-CRM-LEAD-SCORING-04: dry-run preview, tied to the exact rules it was run for.
  const [preview, setPreview] = useState<{ forKey: string; data: ScorePreview } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const headingId = useId();

  const nextRuleRowId = useRef(0);
  const [ruleRowIds, setRuleRowIds] = useState<number[]>([]);
  const ruleKeyFor = (idx: number) => ruleRowIds[idx] ?? idx;

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s, meta } = await getScoreRules();
    if (!isLive()) return;
    const nextRows = data.map(toRow);
    setRows(nextRows);
    setOriginalRows(nextRows);
    setRuleRowIds(nextRows.map(() => nextRuleRowId.current++));
    setVersion(meta?.version);
    setLastChangedBy(meta?.updatedBy);
    setLastChangedAt(meta?.updatedAt);
    setAllowedAttributes(meta?.scoreableAttributes ?? SCOREABLE_LEAD_ATTRIBUTES);
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

  /** Switch a rule's score function: the old function's params do not apply to the new one. */
  function changeFn(idx: number, scoreFnType: ScoreFnType) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx
          ? r.advanced
            ? { ...r, scoreFnType }
            : { ...r, scoreFnType, draft: emptyDraft(), paramsText: "" }
          : r,
      ),
    );
  }

  /** Form <-> JSON toggle. Going to the form is refused if the JSON cannot be shown in it. */
  function toggleAdvanced(idx: number) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        if (!r.advanced) {
          const text = paramsToText(paramsFromDraft(r.scoreFnType, r.draft));
          return { ...r, advanced: true, paramsText: text, formSwitchFailed: false };
        }
        const parsed = parseParams(r.paramsText);
        const draft = parsed === null ? null : draftFromParams(r.scoreFnType, parsed);
        if (draft === null) return { ...r, formSwitchFailed: true };
        return { ...r, advanced: false, draft, formSwitchFailed: false };
      }),
    );
  }

  function addRule() {
    // GAP-CRM-LEAD-SCORING-06: a new rule starts with a blank weight (NaN), not
    // an inert weight of 1 that looks saveable but barely scores. The weight
    // input is aria-invalid and rowValid() blocks Save until a 0-100 integer is
    // entered.
    setRows((prev) => [
      ...prev,
      { attribute: "", weight: Number.NaN, scoreFnType: "presence", enabled: true, advanced: false, paramsText: "", draft: emptyDraft() },
    ]);
    setRuleRowIds((ids) => [...ids, nextRuleRowId.current++]);
  }

  function removeRule(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setRuleRowIds((ids) => ids.filter((_, i) => i !== idx));
  }

  // Running total of enabled weights, used for the total + per-rule share %.
  const enabledWeightTotal = rows.reduce((sum, r) => sum + (r.enabled && Number.isFinite(r.weight) ? r.weight : 0), 0);
  // How many rules name each attribute (the backend keeps ONE rule per attribute, so a
  // duplicate would silently overwrite its twin on save).
  const attributeCounts = new Map<string, number>();
  for (const r of rows) {
    const a = r.attribute.trim();
    if (a) attributeCounts.set(a, (attributeCounts.get(a) ?? 0) + 1);
  }
  const allValid = rows.every((r) => rowValid(r, allowedAttributes, attributeCounts));
  const rulesKey = JSON.stringify(toRules(rows));
  const livePreview = preview && preview.forKey === rulesKey ? preview.data : null;

  // GAP-CRM-LEAD-SCORING-07: rules present at load that are no longer in the
  // list (by attribute + score function). Removing a rule stops it scoring.
  function removedRuleCount(): number {
    const present = new Set(rows.map((r) => `${r.attribute.trim()}::${r.scoreFnType}`));
    return originalRows.filter((o) => !present.has(`${o.attribute.trim()}::${o.scoreFnType}`)).length;
  }
  const removedCount = removedRuleCount();

  async function persist() {
    setBusy(true);
    try {
      const newVersion = await saveScoreRules(toRules(rows), version);
      if (newVersion) setVersion(newVersion);
      setMessage(t("saved"));
      setOriginalRows(rows);
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
    if (!allValid) {
      setError(t("ruleNeedsFields"));
      return;
    }
    // GAP-CRM-LEAD-SCORING-04: changing weights re-scores every lead, so make
    // that explicit before the PUT.
    setConfirmSave(true);
  }

  async function runPreview() {
    setMessage("");
    setError("");
    setPreviewError("");
    if (!allValid) {
      setError(t("ruleNeedsFields"));
      return;
    }
    const key = rulesKey;
    setPreviewBusy(true);
    try {
      const data = await previewScoreRules(toRules(rows));
      setPreview({ forKey: key, data });
    } catch {
      // Never the raw server text -- a catalogued, recoverable message.
      setPreview(null);
      setPreviewError(t("previewFailed"));
    } finally {
      setPreviewBusy(false);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        {t("loading")}
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
        <h3 id={headingId}>{t("heading")}</h3>
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

      {rows.length === 0 ? (
        <EmptyState
          icon="📊"
          title={t("emptyTitle")}
          message={t("emptyMessage")}
        />
      ) : (
        <table className="tbl" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th>{t("colAttribute")}</th>
              <th>{t("colScoreFunction")}</th>
              <th style={{ textAlign: "end" }}>{t("colWeight")}</th>
              <th style={{ textAlign: "end" }}>{t("share")}</th>
              <th>{t("colParams")}</th>
              <th>{t("colEnabled")}</th>
              <th><span className="sr-only">{t("colActions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const n = idx + 1;
              const ps = paramsState(row);
              const attr = row.attribute.trim();
              const unknownAttr = attr.length > 0 && !allowedAttributes.includes(attr);
              const duplicateAttr = attr.length > 0 && (attributeCounts.get(attr) ?? 0) > 1;
              const attrError = unknownAttr ? t("attributeNotScoreable") : duplicateAttr ? t("attributeDuplicate") : "";
              const attrErrId = `${headingId}-attr-${idx}-err`;
              const share = row.enabled && enabledWeightTotal > 0 && Number.isFinite(row.weight)
                ? Math.round((row.weight / enabledWeightTotal) * 100)
                : 0;
              return (
                <tr key={ruleKeyFor(idx)}>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-attr-${idx}`}>{t("attributeForRule", { n })}</label>
                    <select
                      id={`${headingId}-attr-${idx}`}
                      value={row.attribute}
                      aria-invalid={attr && !attrError ? undefined : true}
                      aria-describedby={attrError ? attrErrId : undefined}
                      onChange={(e) => update(idx, { attribute: e.target.value })}
                      style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", maxWidth: 200 }}
                    >
                      <option value="">{t("attributePlaceholder")}</option>
                      {/* A stored rule on a field the scorer does not read stays visible (so it can be
                          seen and removed) but cannot be re-chosen, and blocks the save. */}
                      {unknownAttr ? <option value={row.attribute} disabled>{row.attribute}</option> : null}
                      {allowedAttributes.map((a) => (
                        <option key={a} value={a}>{t.has(`attr_${a}`) ? t(`attr_${a}`) : a}</option>
                      ))}
                    </select>
                    {attrError ? (
                      <span id={attrErrId} role="alert" style={{ display: "block", fontSize: 11, color: "#b42318" }}>
                        {attrError}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-fn-${idx}`}>{t("scoreFunctionForRule", { n })}</label>
                    <select
                      id={`${headingId}-fn-${idx}`}
                      value={row.scoreFnType}
                      onChange={(e) => changeFn(idx, e.target.value as ScoreFnType)}
                      style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                    >
                      {SCORE_FN_TYPES.map((f) => <option key={f} value={f}>{SCORE_FN_LABELS[f]}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <label className="sr-only" htmlFor={`${headingId}-weight-${idx}`}>{t("weightForRule", { n })}</label>
                    <input
                      id={`${headingId}-weight-${idx}`}
                      type="number" min={0} max={100} step={1}
                      value={Number.isFinite(row.weight) ? row.weight : ""}
                      aria-invalid={Number.isFinite(row.weight) ? undefined : true}
                      onChange={(e) => update(idx, { weight: sanitizeNumber(e.target.value) })}
                      style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "end" }}
                    />
                  </td>
                  <td className="num" style={{ fontSize: 12, color: "var(--muted)" }} aria-label={t("shareForRule", { n })}>
                    {row.enabled ? `${share}%` : "—"}
                  </td>
                  <td style={{ minWidth: 260 }}>
                    {row.advanced ? (
                      <div>
                        <label className="sr-only" htmlFor={`${headingId}-params-${idx}`}>{t("paramsJsonForRule", { n })}</label>
                        <input
                          id={`${headingId}-params-${idx}`}
                          value={row.paramsText}
                          aria-invalid={ps.notObject || ps.issues.length > 0 ? true : undefined}
                          aria-describedby={ps.notObject || ps.issues.length > 0 ? `${headingId}-params-${idx}-err` : undefined}
                          onChange={(e) => update(idx, { paramsText: e.target.value, formSwitchFailed: false })}
                          placeholder={SCORE_FN_PARAM_HINTS[row.scoreFnType]}
                          style={{ minWidth: 220, width: "100%", padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                        />
                        <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                          {t("exampleHint", { hint: SCORE_FN_PARAM_HINTS[row.scoreFnType] })}
                        </span>
                        <div id={`${headingId}-params-${idx}-err`}>
                          {ps.notObject ? (
                            <span role="alert" style={{ display: "block", fontSize: 11, color: "#b42318" }}>{t("paramsMustBeObject")}</span>
                          ) : null}
                          {ps.issues.map((issue) => (
                            <span key={`${issue.field}:${issue.code}`} role="alert" style={{ display: "block", fontSize: 11, color: "#b42318" }}>
                              {t(`jsonErr_${issue.code}`, { bound: row.scoreFnType === "recency" ? "maxDays" : "min", field: issue.field })}
                            </span>
                          ))}
                          {row.formSwitchFailed ? (
                            <span role="alert" style={{ display: "block", fontSize: 11, color: "#b42318" }}>{t("cannotUseForm")}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <ScoreParamsEditor
                        idPrefix={`${headingId}-p${idx}`}
                        ruleNumber={n}
                        type={row.scoreFnType}
                        draft={row.draft}
                        issues={ps.issues}
                        onChange={(draft) => update(idx, { draft })}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      style={{ marginTop: 6 }}
                      aria-label={row.advanced ? t("useFormForRule", { n }) : t("editAsJsonForRule", { n })}
                      onClick={() => toggleAdvanced(idx)}
                    >
                      {row.advanced ? t("useForm") : t("editAsJson")}
                    </Button>
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })} aria-label={t("enableRule", { n })} />
                      {row.enabled ? t("on") : t("off")}
                    </label>
                  </td>
                  <td>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeRule(idx)} aria-label={t("removeRule", { n })}>{t("remove")}</Button>
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
                {/* The scorer divides the weighted sum by a FIXED 100 (not by the weight total)
                    and caps at 100, so the enabled total is the highest possible score. */}
                {t("weightsNotNormalised", { total: enabledWeightTotal, max: Math.min(100, enabledWeightTotal) })}
                {enabledWeightTotal !== 100 ? (
                  <strong role="note" style={{ display: "block", color: "#b45309" }}>
                    {enabledWeightTotal < 100
                      ? t("weightsBelow100", { max: enabledWeightTotal })
                      : t("weightsAbove100")}
                  </strong>
                ) : null}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12, flexWrap: "wrap" }}>
        <Button type="button" variant="ghost" onClick={addRule}>{t("addRule")}</Button>
        <Button type="button" variant="secondary" onClick={() => void runPreview()} disabled={busy || previewBusy || rows.length === 0}>
          {previewBusy ? t("previewing") : t("previewImpact")}
        </Button>
        <Button type="button" onClick={save} disabled={busy}>
          {busy ? t("saving") : t("saveRules")}
        </Button>
      </div>

      {previewError ? (
        <p role="alert" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{previewError}</p>
      ) : null}
      {livePreview ? <PreviewSummary preview={livePreview} /> : null}

      <ConfirmDialog
        open={confirmSave}
        title={t("confirmTitle")}
        description={
          <>
            <p style={{ margin: "0 0 8px" }}>
              {t("confirmDescription")}
            </p>
            {livePreview ? (
              <p style={{ margin: "0 0 8px" }}>{t("confirmPreviewLine", { changed: livePreview.changed, sampled: livePreview.sampled })}</p>
            ) : null}
            {removedCount > 0 ? (
              <p style={{ margin: 0, fontWeight: 600 }}>
                {t("removedRules", { count: removedCount })}
              </p>
            ) : null}
          </>
        }
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

/** GAP-CRM-LEAD-SCORING-04: the dry-run result, in plain numbers a clerk can read. */
function PreviewSummary({ preview }: { preview: ScorePreview }) {
  const t = useTranslations("crmLeadScoreRulesEditor");
  const dash = (v: number | null) => (v === null ? "—" : String(v));
  return (
    <section aria-label={t("previewHeading")} style={{ padding: "0 12px 12px" }}>
      <h4 style={{ margin: "0 0 6px" }}>{t("previewHeading")}</h4>
      <p style={{ fontSize: 13, margin: "0 0 4px" }}>
        {t("previewScope", { sampled: preview.sampled, total: preview.totalLeads })}
        {preview.truncated ? ` ${t("previewTruncated")}` : ""}
      </p>
      <p style={{ fontSize: 13, margin: "0 0 4px" }}>
        {t("previewAverage", { current: dash(preview.currentAverage), proposed: dash(preview.proposedAverage) })}
      </p>
      <p style={{ fontSize: 13, margin: "0 0 4px" }}>
        {t("previewChanged", { raised: preview.raised, lowered: preview.lowered, unscored: preview.unscored })}
      </p>
      <p style={{ fontSize: 13, margin: "0 0 8px" }}>
        {t("previewCeiling", { total: preview.totalWeight, max: preview.maxPossibleScore })}
      </p>
      <table className="tbl" aria-label={t("previewBandsLabel")}>
        <thead>
          <tr>
            <th>{t("previewBand")}</th>
            <th style={{ textAlign: "end" }}>{t("previewNow")}</th>
            <th style={{ textAlign: "end" }}>{t("previewAfter")}</th>
          </tr>
        </thead>
        <tbody>
          {preview.bands.map((b) => (
            <tr key={b.label}>
              <td>{b.label}</td>
              <td className="num">{b.current}</td>
              <td className="num">{b.proposed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
