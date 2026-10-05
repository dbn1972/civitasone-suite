"use client";
/**
 * ReasonCodesEditor — LQ-004 admin. Manage the controlled list of lead
 * status-change reason codes surfaced by the transition picker. GET on mount,
 * PUT on save. On a failed load we show a recoverable ErrorState (never the
 * editor) so an errored load can never be saved back as an empty list — saving
 * {codes:[]} from a failed load would erase the tenant's whole reason taxonomy.
 * We never fabricate an empty list as fact.
 *
 * GAP-CRM-LEAD-REASON-CODES-03 (VALIDATION): codes/labels/status are validated
 * against the exact crm-service contract (validateReasonCodes) with per-field
 * aria-invalid + inline messages, so a blank label, a bad-format code, an
 * unchosen status or a duplicate (code, status) is blocked here instead of
 * round-tripping to a raw 400. Codes are lowercased (the backend regex is
 * lowercase snake_case) and the status is a real enum select (not free "any").
 *
 * GAP-CRM-LEAD-REASON-CODES-02 (CONFIRM): removing a loaded code then Saving
 * opens a ConfirmDialog listing exactly which codes drop out of the list, with a
 * steer towards switching Active off instead. The backend upsert is additive
 * (ON CONFLICT DO UPDATE, never DELETE — reason-codes-repo.ts), so a removed row
 * is only dropped from the editable list, not deleted server-side; existing
 * leads keep their captured code text either way. The confirm makes that
 * explicit rather than silent.
 *
 * GAP-CRM-LEAD-REASON-CODES-04 (CONCURRENCY): the backend GET now returns a
 * list-level version (SUM of per-row versions) plus "Last changed by/at", and
 * the PUT requires that version as If-Match. The editor stores the version,
 * sends it on save, and on a 409 shows "changed by another admin — reload"
 * rather than silently clobbering a concurrent admin's change (wave2 backend).
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button, ErrorState } from "../ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDateTime } from "@/lib/formatters";
import {
  getReasonCodes,
  saveReasonCodes,
  validateReasonCodes,
  ConfigConflictError,
  REASON_CODE_TARGET_STATUSES,
  type LeadReasonCode,
  type ReasonCodeRowError,
  type LqSource,
} from "@/lib/crm/leadQualification";

const cellInput = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" } as const;
const DEFAULT_STATUS = REASON_CODE_TARGET_STATUSES[0];

export function ReasonCodesEditor() {
  const t = useTranslations("crmReasonCodesEditor");
  const [codes, setCodes] = useState<LeadReasonCode[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<Map<number, ReasonCodeRowError>>(new Map());
  // The codes present at load, used to compute which codes a Save would drop
  // from the list (GAP-CRM-LEAD-REASON-CODES-02).
  const [originalCodes, setOriginalCodes] = useState<LeadReasonCode[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<LeadReasonCode[] | null>(null);
  // GAP-CRM-LEAD-REASON-CODES-04: list-level optimistic-concurrency token +
  // "Last changed by/at" from the GET metadata.
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [lastChangedBy, setLastChangedBy] = useState<string | undefined>(undefined);
  const [lastChangedAt, setLastChangedAt] = useState<string | undefined>(undefined);
  const headingId = useId();

  // Stable per-row React key, independent of array position -- see
  // ElectFlexBenefitForm.tsx for the full rationale. LeadReasonCode carries no
  // id, so a parallel id list stands in for one.
  const nextCodeRowId = useRef(0);
  const [codeRowIds, setCodeRowIds] = useState<number[]>([]);
  const codeKeyFor = (idx: number) => codeRowIds[idx] ?? idx;

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s, meta } = await getReasonCodes();
    if (!isLive()) return;
    setCodes(data);
    setOriginalCodes(data);
    setCodeRowIds(data.map(() => nextCodeRowId.current++));
    setRowErrors(new Map());
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

  function update(idx: number, patch: Partial<LeadReasonCode>) {
    setCodes((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function addCode() {
    setCodes((prev) => [...prev, { code: "", label: "", appliesToStatus: DEFAULT_STATUS, active: true }]);
    setCodeRowIds((ids) => [...ids, nextCodeRowId.current++]);
  }

  function removeCode(idx: number) {
    setCodes((prev) => prev.filter((_, i) => i !== idx));
    setCodeRowIds((ids) => ids.filter((_, i) => i !== idx));
  }

  /** Codes present at load that are no longer in the editable list (by code+status). */
  function removedCodes(current: LeadReasonCode[]): LeadReasonCode[] {
    const present = new Set(current.map((c) => `${c.appliesToStatus}::${c.code.trim()}`));
    return originalCodes.filter((o) => !present.has(`${o.appliesToStatus}::${o.code.trim()}`));
  }

  async function persist() {
    setBusy(true);
    try {
      const newVersion = await saveReasonCodes(codes, version);
      if (newVersion) setVersion(newVersion);
      setMessage("Reason codes saved.");
      setOriginalCodes(codes);
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
    const errs = validateReasonCodes(codes);
    setRowErrors(errs);
    if (errs.size > 0) {
      setError(t("fixHighlightedRows"));
      return;
    }
    const removed = removedCodes(codes);
    if (removed.length > 0) {
      setConfirmRemove(removed);
      return;
    }
    void persist();
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading reason codes…
      </p>
    );
  }

  // A failed load must never fall through to the editor: saving from an
  // errored view would PUT {codes:[]} and erase the tenant's whole reason
  // taxonomy. Show a recoverable error with no Save/Add instead.
  if (source === "error") {
    return (
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>{t("heading")}</h3>
          <DataSourceBadge source="error" />
        </div>
        <ErrorState error={toHumanError("load", { area: "reason codes" })} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Reason codes</h3>
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
            {codes.map((c, idx) => {
              const err = rowErrors.get(idx);
              return (
                <tr key={codeKeyFor(idx)}>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-code-${idx}`}>{t("codeForReason", { n: idx + 1 })}</label>
                    <input
                      id={`${headingId}-code-${idx}`}
                      value={c.code}
                      aria-invalid={err?.code ? true : undefined}
                      onChange={(e) => update(idx, { code: e.target.value.toLowerCase() })}
                      placeholder={t("codePlaceholder")}
                      style={cellInput}
                    />
                    {err?.code ? <span style={{ display: "block", fontSize: 11, color: "#b42318" }}>{err.code}</span> : null}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-label-${idx}`}>{t("labelForReason", { n: idx + 1 })}</label>
                    <input
                      id={`${headingId}-label-${idx}`}
                      value={c.label}
                      aria-invalid={err?.label ? true : undefined}
                      onChange={(e) => update(idx, { label: e.target.value })}
                      placeholder={t("labelPlaceholder")}
                      style={cellInput}
                    />
                    {err?.label ? <span style={{ display: "block", fontSize: 11, color: "#b42318" }}>{err.label}</span> : null}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-status-${idx}`}>{t("statusForReason", { n: idx + 1 })}</label>
                    <select
                      id={`${headingId}-status-${idx}`}
                      value={c.appliesToStatus}
                      aria-invalid={err?.appliesToStatus ? true : undefined}
                      onChange={(e) => update(idx, { appliesToStatus: e.target.value })}
                      style={cellInput}
                    >
                      {REASON_CODE_TARGET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {err?.appliesToStatus ? <span style={{ display: "block", fontSize: 11, color: "#b42318" }}>{err.appliesToStatus}</span> : null}
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={c.active} onChange={(e) => update(idx, { active: e.target.checked })} aria-label={t("activateReason", { n: idx + 1 })} />
                      {c.active ? t("on") : t("off")}
                    </label>
                  </td>
                  <td>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeCode(idx)} aria-label={t("removeReason", { n: idx + 1 })}>{t("remove")}</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p style={{ fontSize: 12, color: "var(--muted)", padding: "0 12px" }}>
        {t.rich("retireHint", { strong: (chunks) => <strong>{chunks}</strong>, em: (chunks) => <em>{chunks}</em> })}
      </p>

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <Button type="button" variant="ghost" onClick={addCode}>+ Add reason code</Button>
        <Button type="button" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save reason codes"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRemove !== null}
        title={confirmRemove ? t("removeTitle", { count: confirmRemove.length }) : ""}
        description={
          confirmRemove ? (
            <>
              <p style={{ margin: "0 0 8px" }}>
                {t("removeDescription")}
              </p>
              <ul style={{ margin: "0 0 8px 18px" }}>
                {confirmRemove.map((c) => (
                  <li key={`${c.appliesToStatus}::${c.code}`} style={{ fontSize: 13 }}>
                    <strong>{c.code}</strong> — {c.label} <span style={{ color: "var(--muted)" }}>({c.appliesToStatus})</span>
                  </li>
                ))}
              </ul>
              <p style={{ margin: 0, fontWeight: 600 }}>{t("removePrefer")}</p>
            </>
          ) : null
        }
        confirmLabel={t("removeAndSave")}
        busy={busy}
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => {
          setConfirmRemove(null);
          void persist();
        }}
      />
    </div>
  );
}
