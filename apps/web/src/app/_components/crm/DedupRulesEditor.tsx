"use client";
/**
 * DedupRulesEditor — DQ-001 admin. View and edit the configurable matching
 * rules that drive duplicate detection. GET on mount, PUT on save. Stats/rows
 * follow the source==="error" pattern: on a failed load we show the saved-info
 * badge and never fabricate an empty rule set as fact.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { EmptyState, Button, ErrorState, ConfirmDialog, HelpTip } from "../ds";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDateTime } from "@/lib/formatters";
import {
  getDedupRules,
  saveDedupRules,
  DedupRulesConflictError,
  type DedupRule,
  type DedupField,
  type DedupMatchType,
  type DqSource,
} from "@/lib/crm/dataQuality";

const FIELD_OPTIONS: DedupField[] = ["email", "phone", "gstin", "pan", "name", "company"];
const MATCH_OPTIONS: DedupMatchType[] = ["exact", "fuzzy"];

/**
 * GAP-CRM-DEDUP-RULES-06: human labels for the field/match-type selects so a
 * clerk reads "GSTIN"/"Exact match" instead of the raw enum tokens
 * "gstin"/"exact". The <option value> stays the enum the backend expects.
 */

/**
 * Coerce a numeric-input string to a finite integer 0-100 so a partial or
 * invalid entry ("", "-", "1.5", "abc") never lands something the backend
 * rejects. services/crm-service dedup-routes.ts requires both weight and
 * threshold to be z.number().int().min(0).max(100) -- this editor used to
 * offer fractional 0-1 inputs (step 0.1 / 0.05) that could only ever
 * produce a value the server accepts by accident (exactly 0 or 1), so
 * "Save rules" 400'd for any realistic weight/threshold.
 */
function sanitizeNumber(raw: string, opts: { max?: number } = {}): number {
  const n = Math.round(Number(raw));
  const max = opts.max ?? 100;
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > max) return max;
  return n;
}

/** True when a rule's weight/threshold are safe to persist (matches the
 *  backend's z.number().int().min(0).max(100) contract exactly). */
function ruleNumbersValid(rule: DedupRule): boolean {
  return (
    Number.isInteger(rule.weight) &&
    rule.weight >= 0 &&
    rule.weight <= 100 &&
    Number.isInteger(rule.threshold) &&
    rule.threshold >= 0 &&
    rule.threshold <= 100
  );
}

/**
 * GAP-CRM-DEDUP-RULES-03: the backend upserts by (tenant, field), so two rules
 * on the same field silently collapse to one on save (and two different
 * match-types on one field are contradictory). Return the first field that is
 * configured more than once, or null when every field is unique.
 */
function firstDuplicateField(rules: DedupRule[]): DedupField | null {
  const seen = new Set<DedupField>();
  for (const r of rules) {
    if (seen.has(r.field)) return r.field;
    seen.add(r.field);
  }
  return null;
}

/** A stable snapshot for dirty-state comparison (GAP-CRM-DEDUP-RULES-02). */
function snapshot(rules: DedupRule[]): string {
  return JSON.stringify(rules);
}

export function DedupRulesEditor() {
  const t = useTranslations("crmDedupRulesEditor");
  const [rules, setRules] = useState<DedupRule[]>([]);
  const [source, setSource] = useState<DqSource | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const formError = useFormError("matching rules");
  // Guards the destructive "save an empty rule set" path (GAP-CRM-DEDUP-RULES-01).
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // GAP-CRM-DEDUP-RULES-02: optimistic-concurrency token from load, and the
  // loaded snapshot used to tell whether there are unsaved edits.
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [loadedSnapshot, setLoadedSnapshot] = useState<string>("[]");
  // GAP-CRM-DEDUP-RULES-02: "Last changed by/at" from the GET metadata.
  const [lastChangedBy, setLastChangedBy] = useState<string | undefined>(undefined);
  const [lastChangedAt, setLastChangedAt] = useState<string | undefined>(undefined);
  const headingId = useId();

  const dirty = source === "api" && snapshot(rules) !== loadedSnapshot;

  // Stable per-row React key, independent of array position -- see
  // ElectFlexBenefitForm.tsx (apps/web/src/app/(app)/hr/payroll/flex-benefits)
  // for the full rationale: keying by index let removing an earlier rule
  // shift a later, focused one up into a different key, so React patched the
  // focused DOM node in place with the wrong rule's data instead of removing
  // the right node and leaving the rest (and focus) alone. DedupRule itself
  // carries no id, so a parallel id list (regenerated whenever load()
  // replaces the whole array, and kept in step by addRule/removeRule below)
  // stands in for one.
  const nextRuleRowId = useRef(0);
  const [ruleRowIds, setRuleRowIds] = useState<number[]>([]);
  const ruleKeyFor = (idx: number) => ruleRowIds[idx] ?? idx;

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s, version: v, updatedBy, updatedAt } = await getDedupRules();
    // Skip if the editor unmounted while this request was in flight.
    if (!isLive()) return;
    setRules(data);
    setRuleRowIds(data.map(() => nextRuleRowId.current++));
    setSource(s);
    setVersion(v);
    setLastChangedBy(updatedBy);
    setLastChangedAt(updatedAt);
    setLoadedSnapshot(snapshot(data));
    setMessage("");
    setError("");
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, []);

  // GAP-CRM-DEDUP-RULES-02: warn before a full page unload (close/reload/
  // external nav) while there are unsaved edits, so a tenant-wide config
  // change is not lost silently. In-app navigation shows the inline "unsaved
  // changes" banner below (Next's App Router has no stable navigation-block API).
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function update(idx: number, patch: Partial<DedupRule>) {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRule() {
    setRules((prev) => [
      ...prev,
      // GAP-CRM-DEDUP-RULES-03: default weight 50 (a meaningful contribution),
      // not 1 — a weight-1 rule has almost no effect until the admin notices
      // and edits it. Default to the first field not already configured so a
      // new rule doesn't immediately collide with an existing one.
      {
        field: FIELD_OPTIONS.find((f) => !prev.some((r) => r.field === f)) ?? "email",
        matchType: "exact",
        weight: 50,
        threshold: 90,
        enabled: true,
      },
    ]);
    setRuleRowIds((ids) => [...ids, nextRuleRowId.current++]);
  }

  function removeRule(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
    setRuleRowIds((ids) => ids.filter((_, i) => i !== idx));
  }

  async function doSave() {
    setBusy(true);
    try {
      const newVersion = await saveDedupRules(rules, version);
      // Keep the stored token current so a follow-up save isn't a false conflict.
      if (newVersion) setVersion(newVersion);
      setMessage("Matching rules saved.");
      setLoadedSnapshot(snapshot(rules));
    } catch (e) {
      if (e instanceof DedupRulesConflictError) {
        // GAP-CRM-DEDUP-RULES-02: a concurrent admin changed the rules; retrying
        // the stale write would clobber theirs, so prompt a reload instead.
        setError(t("conflictChanged"));
      } else {
        setError(formError.fromException("save", e).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setMessage("");
    setError("");
    // Never PUT off a failed load: the current rule set is unknown, so saving
    // would overwrite the tenant's live config with whatever is on screen
    // (an empty array on an error load) — a silent wipe (GAP-CRM-DEDUP-RULES-01).
    if (source !== "api") {
      setError(t("notLoaded"));
      return;
    }
    if (!rules.every(ruleNumbersValid)) {
      setError(t("invalidNumbers"));
      return;
    }
    // GAP-CRM-DEDUP-RULES-03: two rules on the same field collapse to one on
    // the backend's (tenant, field) upsert, so block it with an inline error.
    const dup = firstDuplicateField(rules);
    if (dup) {
      setError(t("duplicateField", { field: dup }));
      return;
    }
    // Saving an empty list clears every matching rule — require an explicit
    // confirmation before wiping the tenant's deduplication config.
    if (rules.length === 0) {
      setConfirmEmpty(true);
      return;
    }
    await doSave();
  }

  async function confirmEmptySave() {
    setConfirmEmpty(false);
    await doSave();
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading matching rules…
      </p>
    );
  }

  // A failed load must NOT fall through to the "No matching rules yet" empty
  // state with an enabled Save button: saving from there PUTs an empty rule set
  // and wipes the tenant's dedup config. Show a retry instead. RefreshErrorState
  // only calls router.refresh(), which will not re-run this client fetch, so we
  // use ErrorState with an explicit onRetry={load} (GAP-CRM-DEDUP-RULES-01).
  if (source === "error") {
    return (
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>{t("heading")}</h3>
          <DataSourceBadge source="error" />
        </div>
        <ErrorState error={toHumanError("load", { area: "matching rules" })} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Matching rules</h3>
      </div>
      {lastChangedAt ? (
        <p style={{ fontSize: 12, color: "var(--muted)", padding: "0 12px" }}>
          {lastChangedBy
            ? t("lastChangedAtBy", { at: formatIndianDateTime(lastChangedAt), by: lastChangedBy })
            : t("lastChangedAt", { at: formatIndianDateTime(lastChangedAt) })}
        </p>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good, #047857)", padding: "0 12px" }}>{message}</p>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--bad, #b42318)", padding: "0 12px" }}>{error}</p>
      ) : null}
      {dirty ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--warn, #92400e)", padding: "0 12px" }}>
          {t("unsavedChanges")}
        </p>
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
              <th style={{ textAlign: "end" }}>
                {t("weight")}{" "}
                <HelpTip term={t("weight")}>
                  {t("weightHelp")}
                </HelpTip>
              </th>
              <th style={{ textAlign: "end" }}>
                {t("threshold")}{" "}
                <HelpTip term={t("threshold")}>
                  {t("thresholdHelp")}
                </HelpTip>
              </th>
              <th>Enabled</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, idx) => (
              <tr key={ruleKeyFor(idx)}>
                <td>
                  <label className="sr-only" htmlFor={`${headingId}-field-${idx}`}>Field for rule {idx + 1}</label>
                  <select
                    id={`${headingId}-field-${idx}`}
                    value={rule.field}
                    onChange={(e) => update(idx, { field: e.target.value as DedupField })}
                    style={{ padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
                  >
                    {FIELD_OPTIONS.map((f) => <option key={f} value={f}>{t(`field.${f}`)}</option>)}
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
                    {MATCH_OPTIONS.map((m) => <option key={m} value={m}>{t(`match.${m}`)}</option>)}
                  </select>
                </td>
                <td className="num">
                  <label className="sr-only" htmlFor={`${headingId}-weight-${idx}`}>Weight for rule {idx + 1}</label>
                  <input
                    id={`${headingId}-weight-${idx}`}
                    type="number" min={0} max={100} step={1}
                    value={Number.isFinite(rule.weight) ? rule.weight : ""}
                    aria-invalid={Number.isFinite(rule.weight) ? undefined : true}
                    onChange={(e) => update(idx, { weight: sanitizeNumber(e.target.value) })}
                    style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "end" }}
                  />
                </td>
                <td className="num">
                  <label className="sr-only" htmlFor={`${headingId}-threshold-${idx}`}>Threshold for rule {idx + 1}</label>
                  <input
                    id={`${headingId}-threshold-${idx}`}
                    type="number" min={0} max={100} step={1}
                    value={Number.isFinite(rule.threshold) ? rule.threshold : ""}
                    aria-invalid={Number.isFinite(rule.threshold) ? undefined : true}
                    onChange={(e) => update(idx, { threshold: sanitizeNumber(e.target.value) })}
                    style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "end" }}
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
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeRule(idx)} aria-label={`Remove rule ${idx + 1}`}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12, alignItems: "center" }}>
        <Button type="button" variant="ghost" onClick={addRule}>+ Add rule</Button>
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save rules"}
        </Button>
        {rules.length > 0 ? (
          <span style={{ marginInlineStart: "auto", fontSize: 13, color: "var(--muted)" }}>
            {t.rich("totalEnabledWeight", {
              total: rules.filter((r) => r.enabled).reduce((sum, r) => sum + (Number.isFinite(r.weight) ? r.weight : 0), 0),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </span>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmEmpty}
        danger
        title={t("confirmEmptyTitle")}
        description={t("confirmEmptyDescription")}
        confirmLabel={t("confirmEmptyConfirm")}
        busy={busy}
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={() => void confirmEmptySave()}
      />
    </div>
  );
}
