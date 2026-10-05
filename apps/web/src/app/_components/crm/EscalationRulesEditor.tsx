"use client";
/**
 * EscalationRulesEditor — AS-004 admin. CRUD the rules that escalate leads which
 * sit unaccepted or unattended past a threshold. Each row is created (POST),
 * updated (PUT) or deleted (DELETE) individually. Threshold is minute-guarded
 * (a positive whole number) and a recipient (role or user) is required, so an
 * invalid row is blocked. Deletion is governed via ConfirmDialog. On a failed
 * load we show the saved-info badge and never fabricate an empty set as fact.
 */
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button, ErrorState } from "../ds";
import { toHumanError } from "@/lib/messages";
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
import {
  getEscalationRoles,
  getEscalationUsers,
  type EscalationRole,
  type EscalationUser,
} from "@/lib/crm/activityAccount";

interface Row extends EscalationRule {
  key: string;
  /** True once the admin edited this row since its last save/load (GAP-CRM-ESCALATION-RULES-03). */
  dirty?: boolean;
}
let SEQ = 0;
function toRow(r: EscalationRule): Row {
  return { ...r, key: r.id ?? `new-${SEQ++}` };
}

/**
 * GAP-CRM-ESCALATION-RULES-04: humanise a minutes threshold as a plain-language
 * preview (the value is always stored in minutes). 1440 -> "1 day"; 1560 ->
 * "1 day 2 hours"; 90 -> "1 hour 30 minutes"; 45 -> "45 minutes".
 */
function humanizeMinutes(total: number): string {
  if (!Number.isInteger(total) || total <= 0) return "—";
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** GAP-CRM-ESCALATION-RULES-04: unit options for the threshold input. */
const THRESHOLD_UNITS: ReadonlyArray<{ key: "minutes" | "hours" | "days"; label: string; factor: number }> = [
  { key: "minutes", label: "minutes", factor: 1 },
  { key: "hours", label: "hours", factor: 60 },
  { key: "days", label: "days", factor: 1440 },
];

/**
 * A rule needs a positive threshold and a recipient (role OR user). When the
 * tenant directory is loaded, the chosen role/user must come from it — a
 * mistyped/stale target can no longer save and escalate to nobody
 * (GAP-CRM-ESCALATION-RULES-01). When the directory is unavailable we fall back
 * to "non-empty" so the editor still works.
 */
/** Mirrors the crm-service cap on thresholdMinutes (assignment/validators.ts). */
const MAX_THRESHOLD_MINUTES = 100_000;

function rowValid(row: Row, roles: EscalationRole[], users: EscalationUser[]): boolean {
  if (!Number.isInteger(row.thresholdMinutes) || row.thresholdMinutes <= 0 || row.thresholdMinutes > MAX_THRESHOLD_MINUTES) return false;
  const role = row.recipientRole.trim();
  const uid = row.recipientId.trim();
  if (!role && !uid) return false;
  if (role && roles.length > 0 && !roles.some((r) => r.key === role)) return false;
  if (uid && users.length > 0 && !users.some((u) => u.id === uid)) return false;
  return true;
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

export function EscalationRulesEditor() {
  const t = useTranslations("crmEscalationRulesEditor");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [roles, setRoles] = useState<EscalationRole[]>([]);
  const [users, setUsers] = useState<EscalationUser[]>([]);
  // GAP-CRM-ESCALATION-RULES-04: per-row display unit for the threshold input.
  // The stored value is always minutes; this only changes how the admin types
  // and reads it. Keyed by row.key; defaults to minutes when absent.
  const [thresholdUnit, setThresholdUnit] = useState<Record<string, "minutes" | "hours" | "days">>({});
  const headingId = useId();

  /**
   * GAP-CRM-ESCALATION-RULES-03: a reload must not blow away unsaved edits in
   * OTHER rows. We merge the server rows by id, dropping only the row we just
   * saved/deleted's stale copy, and KEEP any dirty row or unsaved ('new-') row.
   * `initial` distinguishes the first mount (full replace) from a post-mutation
   * refresh (merge).
   */
  async function load(isLive: () => boolean = () => true, opts: { merge?: boolean } = {}) {
    if (!opts.merge) setSource("loading");
    const { data, source: s } = await getEscalationRules();
    if (!isLive()) return;
    if (s === "error") {
      // Keep whatever is on screen; surface the error, never a fake empty set
      // (GAP-CRM-ESCALATION-RULES-02).
      setSource("error");
      return;
    }
    if (opts.merge) {
      setRows((prev) => {
        const serverById = new Map(data.map((d) => [d.id, d]));
        // Start from fresh server rows, then overlay any dirty/unsaved local rows.
        const merged: Row[] = data.map(toRow);
        for (const r of prev) {
          if (!r.id) {
            // Unsaved new row — keep it.
            merged.push(r);
          } else if (r.dirty && serverById.has(r.id)) {
            // Dirty edit to a persisted row — keep the local edit, not the server copy.
            const idx = merged.findIndex((m) => m.id === r.id);
            if (idx >= 0) merged[idx] = r;
          }
        }
        return merged;
      });
    } else {
      setRows(data.map(toRow));
    }
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    // Tenant role + user directory for the recipient pickers (non-fatal if it
    // fails — rowValid then falls back to a non-empty check).
    void Promise.all([getEscalationRoles(), getEscalationUsers()]).then(([r, u]) => {
      if (!live) return;
      setRoles(r.data);
      setUsers(u.data);
    });
    return () => { live = false; };
  }, []);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));
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
    if (!rowValid(row, roles, users)) {
      setError(t("ruleNeedsThresholdRecipient"));
      return;
    }
    // GAP-CRM-ESCALATION-RULES-05: block a duplicate rule (same trigger +
    // threshold + recipient) against the rows already on screen, so two
    // identical rules can't both fire (and double-notify / double-reassign).
    // The server enforces the same uniqueness (migration 0105) and 409s, but
    // catching it here gives an immediate, inline message.
    const isDuplicate = rows.some(
      (r) =>
        r.key !== row.key &&
        r.trigger === row.trigger &&
        r.thresholdMinutes === row.thresholdMinutes &&
        r.recipientRole.trim() === row.recipientRole.trim() &&
        r.recipientId.trim() === row.recipientId.trim(),
    );
    if (isDuplicate) {
      setError("A rule with the same trigger, threshold and recipient already exists. Edit the existing rule instead.");
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
      // Drop the just-saved row from local state so the merge-reload replaces it
      // with the freshly-persisted server copy (a new row would otherwise show
      // twice; a persisted row would keep a stale dirty copy). OTHER rows' edits
      // are preserved by the merge (GAP-CRM-ESCALATION-RULES-03).
      setRows((prev) => prev.filter((r) => r.key !== row.key));
      setMessage("Escalation rule saved.");
      await load(() => true, { merge: true });
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
      await load(() => true, { merge: true });
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
  const isError = source === "error";

  // GAP-CRM-ESCALATION-RULES-05: present the rules sorted by trigger, then by
  // threshold ascending, so when several rules could match a lead the admin can
  // see the order the shortest threshold fires first. Unsaved ('new-') rows are
  // kept at the end so a row being typed doesn't jump around mid-edit.
  const sortedRows = [...rows].sort((a, b) => {
    const aNew = !a.id ? 1 : 0;
    const bNew = !b.id ? 1 : 0;
    if (aNew !== bNew) return aNew - bNew;
    if (a.trigger !== b.trigger) return a.trigger.localeCompare(b.trigger);
    const at = Number.isInteger(a.thresholdMinutes) ? a.thresholdMinutes : Number.MAX_SAFE_INTEGER;
    const bt = Number.isInteger(b.thresholdMinutes) ? b.thresholdMinutes : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Escalation rules</h3>
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      {isError ? (
        // GAP-CRM-ESCALATION-RULES-02: never present a failed load as an empty
        // configuration. Show a clerk-safe error with Retry (re-runs the client
        // fetch) and hide the Add button so no duplicate is created blind.
        <div style={{ padding: 12 }}>
          <ErrorState error={toHumanError("load", { area: "escalation rules" })} onRetry={() => void load()} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="⏰"
          title="No escalation rules yet"
          message="Add a rule to escalate leads that sit unaccepted or unattended beyond a time threshold."
        />
      ) : (
        // GAP-CRM-ESCALATION-RULES-06: wrap the 7-column table in .tbl-wrap so
        // it scrolls horizontally inside the card on narrow viewports instead
        // of overflowing the card / page.
        <>
        {/* GAP-CRM-ESCALATION-RULES-05: precedence note — rows are shown sorted
            by trigger then shortest threshold first, which is the order they
            fire when more than one rule matches a lead. */}
        <p style={{ fontSize: 12, color: "var(--muted)", padding: "0 12px 4px" }}>
          Rules are listed by trigger, then shortest threshold first. When more than one rule matches a lead, the shortest threshold escalates first.
        </p>
        <div className="tbl-wrap">
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
            {sortedRows.map((row, i) => {
              const n = i + 1;
              const busy = busyKey === row.key;
              const threshOk = Number.isInteger(row.thresholdMinutes) && row.thresholdMinutes > 0 && row.thresholdMinutes <= MAX_THRESHOLD_MINUTES;
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
                    <label className="sr-only" htmlFor={`${headingId}-th-${row.key}`}>Threshold for rule {n}</label>
                    {/* GAP-CRM-ESCALATION-RULES-04: numeric input + unit select
                        (minutes/hours/days). The stored value stays in minutes;
                        the unit only scales what the admin types. A humanised
                        preview shows the resolved duration. */}
                    {(() => {
                      const unit = thresholdUnit[row.key] ?? "minutes";
                      const factor = THRESHOLD_UNITS.find((u) => u.key === unit)?.factor ?? 1;
                      const shown = Number.isInteger(row.thresholdMinutes) && row.thresholdMinutes > 0
                        ? row.thresholdMinutes / factor
                        : "";
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              id={`${headingId}-th-${row.key}`}
                              type="number" min={1} max={Math.floor(MAX_THRESHOLD_MINUTES / factor)} step={unit === "minutes" ? 1 : "any"}
                              value={Number.isInteger(Number(shown)) ? shown : (shown === "" ? "" : Number(shown))}
                              aria-invalid={threshOk ? undefined : true}
                              onChange={(e) => {
                                const raw = Number(e.target.value);
                                const minutes = Number.isFinite(raw) && raw > 0 ? Math.round(raw * factor) : Number.NaN;
                                update(row.key, { thresholdMinutes: minutes });
                              }}
                              style={{ ...inputStyle, width: 80, textAlign: "end" }}
                            />
                            <label className="sr-only" htmlFor={`${headingId}-unit-${row.key}`}>Threshold unit for rule {n}</label>
                            <select
                              id={`${headingId}-unit-${row.key}`}
                              value={unit}
                              onChange={(e) => setThresholdUnit((prev) => ({ ...prev, [row.key]: e.target.value as "minutes" | "hours" | "days" }))}
                              style={{ ...inputStyle, width: 96 }}
                            >
                              {THRESHOLD_UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                            </select>
                          </div>
                          <span style={{ fontSize: 11, color: "var(--muted)" }} aria-live="polite">
                            = {humanizeMinutes(row.thresholdMinutes)}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-role-${row.key}`}>Recipient role for rule {n}</label>
                    {/* GAP-CRM-ESCALATION-RULES-01: a SELECT fed by the tenant's
                        roles — a mistyped role can no longer save. Falls back to
                        a free-text input only when the directory is unavailable. */}
                    {roles.length > 0 ? (
                      <select
                        id={`${headingId}-role-${row.key}`}
                        value={row.recipientRole}
                        onChange={(e) => update(row.key, { recipientRole: e.target.value })}
                        style={inputStyle}
                      >
                        <option value="">{t("noRole")}</option>
                        {row.recipientRole && !roles.some((r) => r.key === row.recipientRole) && (
                          <option value={row.recipientRole}>{t("unknownRole", { role: row.recipientRole })}</option>
                        )}
                        {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                      </select>
                    ) : (
                      <input id={`${headingId}-role-${row.key}`} value={row.recipientRole} onChange={(e) => update(row.key, { recipientRole: e.target.value })} placeholder={t("rolePlaceholder")} style={inputStyle} />
                    )}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`${headingId}-uid-${row.key}`}>Recipient user for rule {n}</label>
                    {users.length > 0 ? (
                      <select
                        id={`${headingId}-uid-${row.key}`}
                        value={row.recipientId}
                        onChange={(e) => update(row.key, { recipientId: e.target.value })}
                        style={inputStyle}
                      >
                        <option value="">{t("noSpecificUser")}</option>
                        {row.recipientId && !users.some((u) => u.id === row.recipientId) && (
                          <option value={row.recipientId}>{t("unknownUser")}</option>
                        )}
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    ) : (
                      <input id={`${headingId}-uid-${row.key}`} value={row.recipientId} onChange={(e) => update(row.key, { recipientId: e.target.value })} placeholder={t("userIdPlaceholder")} style={inputStyle} />
                    )}
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.reassign} onChange={(e) => update(row.key, { reassign: e.target.checked })} aria-label={`Reassign on escalation for rule ${n}`} />
                      {row.reassign ? "Yes" : "No"}
                    </label>
                    {/* GAP-CRM-ESCALATION-RULES-04: explain what Reassign does.
                        Per the scheduler (crm-service assignment/scheduler.ts),
                        when on the lead is handed to the rule's configured
                        escalation owner; when off (or no owner is configured)
                        the lead is only flagged as escalated and the recipient
                        above is notified. */}
                    <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 2, maxWidth: 160 }}>
                      When on, the lead is reassigned to the rule&apos;s escalation owner; otherwise it is only flagged and the recipient is notified.
                    </span>
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} aria-label={`Enable rule ${n}`} />
                      {row.enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {row.dirty ? <span style={{ fontSize: 11, color: "#b45309" }} aria-label={t("ruleUnsavedAria", { n })}>{t("unsaved")}</span> : null}
                      <Button type="button" size="sm" onClick={() => void saveRow(row)} disabled={busy}>
                        {busy ? "…" : row.id ? "Save" : "Create"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmKey(row.key)} disabled={busy} aria-label={`Delete rule ${n}`}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        {!isError ? <Button type="button" variant="ghost" onClick={addRule}>+ Add escalation rule</Button> : null}
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
