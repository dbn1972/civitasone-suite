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
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button, ErrorState } from "../ds";
import { OwnerPicker, type Owner } from "./OwnerPicker";
import { toHumanError } from "@/lib/messages";
import { formatIndianDateTime } from "@/lib/formatters";
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
import { validateCriteria, summariseCriteria } from "@/lib/crm/assignmentCriteria";

/** Row state keeps criteria as raw text so a half-typed JSON never crashes state. */
interface RuleRow extends Omit<AssignmentRule, "criteria"> {
  /** Stable local key for React (id when persisted, else a synthetic key). */
  key: string;
  criteriaText: string;
  /**
   * The persisted `enabled` flag as last loaded, so a save that flips it can
   * prompt for confirmation (GAP-CRM-ASSIGNMENT-RULES-05). Undefined for a
   * brand-new (unsaved) row.
   */
  origEnabled?: boolean;
  /** Selected fallback owner as {id,name} so the picker shows a name, not a raw id (GAP-CRM-ASSIGNMENT-RULES-02). */
  fallbackOwner: Owner | null;
}

let SEQ = 0;
function toRow(r: AssignmentRule): RuleRow {
  const { criteria, ...rest } = r;
  return {
    ...rest,
    key: r.id ?? `new-${SEQ++}`,
    criteriaText: criteria && Object.keys(criteria).length > 0 ? JSON.stringify(criteria) : "",
    origEnabled: r.id ? r.enabled : undefined,
    fallbackOwner: r.fallbackOwnerId ? { id: r.fallbackOwnerId, name: r.fallbackOwnerId } : null,
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

/**
 * The per-strategy problem with a row's criteria, or null when it is valid.
 * Covers both "not parseable JSON object" and "wrong shape for this strategy".
 */
type Translate = ReturnType<typeof useTranslations>;

function criteriaError(row: RuleRow, t: Translate): string | null {
  const parsed = parseCriteria(row.criteriaText);
  if (parsed === null) return t("criteriaNotObject", { example: '{"territory":"west","ownerId":"…"}' });
  const v = validateCriteria(row.ruleType, parsed);
  return v.ok ? null : (v.error ?? t("criteriaInvalidFallback"));
}

function criteriaValid(row: RuleRow): boolean {
  const parsed = parseCriteria(row.criteriaText);
  return parsed !== null && validateCriteria(row.ruleType, parsed).ok;
}

function rowValid(row: RuleRow): boolean {
  return (
    row.name.trim().length > 0 &&
    Number.isInteger(row.ordinal) &&
    row.ordinal >= 0 &&
    criteriaValid(row)
  );
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;

export function AssignmentRulesEditor() {
  const t = useTranslations("crmAssignmentRulesEditor");
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [source, setSource] = useState<AsSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  /** A row whose enable/disable flip is awaiting confirmation (GAP-CRM-ASSIGNMENT-RULES-05). */
  const [toggleConfirmKey, setToggleConfirmKey] = useState<string | null>(null);
  const headingId = useId();

  /**
   * Load the chain. On error we KEEP whatever rows are already shown (so a
   * failed reload after a save never blanks an in-progress table) and only
   * surface the error badge/state (GAP-CRM-ASSIGNMENT-RULES-03). Returns ok so
   * callers can decide whether to trust the reload.
   */
  async function load(isLive: () => boolean = () => true): Promise<{ ok: boolean }> {
    setSource("loading");
    const { data, source: s } = await getAssignmentRules();
    if (!isLive()) return { ok: s !== "error" };
    if (s === "error") {
      // Do NOT replace the current rows with [] — that would read as an empty
      // chain. Keep what's on screen and show the error state instead.
      setSource("error");
      return { ok: false };
    }
    setRows(data.map(toRow));
    setSource(s);
    return { ok: true };
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
    // Default to max(ordinal)+1 so a new rule never collides when the chain
    // has gaps (GAP-CRM-ASSIGNMENT-RULES-04).
    setRows((prev) => {
      const maxOrd = prev.reduce((m, r) => (Number.isInteger(r.ordinal) ? Math.max(m, r.ordinal) : m), -1);
      return [
        ...prev,
        toRow({ name: "", ruleType: "territory", criteria: {}, ordinal: maxOrd + 1, enabled: true, fallbackOwnerId: "" }),
      ];
    });
  }

  /**
   * The set of ordinals used by more than one row — the chain is ambiguous
   * while any duplicate exists, so Save is blocked for the offending rows
   * (GAP-CRM-ASSIGNMENT-RULES-04).
   */
  function duplicateOrdinals(rs: RuleRow[]): Set<number> {
    const seen = new Map<number, number>();
    for (const r of rs) {
      if (!Number.isInteger(r.ordinal)) continue;
      seen.set(r.ordinal, (seen.get(r.ordinal) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, c]) => c > 1).map(([o]) => o));
  }

  /** Name of another row that already uses `ordinal`, for the inline error. */
  function ownerOfOrdinal(rs: RuleRow[], key: string, ordinal: number): string | null {
    const other = rs.find((r) => r.key !== key && r.ordinal === ordinal);
    return other ? other.name.trim() || t("unnamed") : null;
  }

  /**
   * Swap this row's ordinal with its neighbour's in the given direction and
   * persist BOTH, sequentially (GAP-CRM-ASSIGNMENT-RULES-04). Only saved rows
   * participate so we always have ids to PUT.
   */
  async function move(row: RuleRow, dir: "up" | "down") {
    const sorted = rows.slice().sort((a, b) => a.ordinal - b.ordinal);
    const idx = sorted.findIndex((r) => r.key === row.key);
    const neighbour = dir === "up" ? sorted[idx - 1] : sorted[idx + 1];
    if (!neighbour || !row.id || !neighbour.id) return;
    const a = { ...row, ordinal: neighbour.ordinal };
    const b = { ...neighbour, ordinal: row.ordinal };
    setRows((prev) => prev.map((r) => (r.key === a.key ? a : r.key === b.key ? b : r)));
    setMessage("");
    setError("");
    setBusyKey(row.key);
    try {
      await updateAssignmentRule(a.id!, toRule(a));
      await updateAssignmentRule(b.id!, toRule(b));
      setMessage(t("ruleOrderUpdated"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("couldNotReorder"));
    } finally {
      setBusyKey(null);
    }
  }

  /** Build the API payload from a row. */
  function toRule(row: RuleRow): AssignmentRule {
    return {
      ...(row.id ? { id: row.id } : {}),
      name: row.name.trim(),
      ruleType: row.ruleType,
      criteria: parseCriteria(row.criteriaText) ?? {},
      ordinal: row.ordinal,
      enabled: row.enabled,
      fallbackOwnerId: row.fallbackOwner?.id ?? "",
    };
  }

  async function saveRow(row: RuleRow) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      const cErr = criteriaError(row, t);
      const ruleName = row.name || t("unnamed");
      setError(
        cErr
          ? t("ruleCriteriaError", { name: ruleName, error: cErr })
          : t("ruleNeedsNameOrder", { name: ruleName }),
      );
      return;
    }
    // Block a save while another row shares this ordinal — the chain's
    // evaluation order would be ambiguous (GAP-CRM-ASSIGNMENT-RULES-04).
    const dupOwner = ownerOfOrdinal(rows, row.key, row.ordinal);
    if (dupOwner !== null) {
      setError(t("orderAlreadyUsedSave", { order: row.ordinal, name: dupOwner }));
      return;
    }
    // Confirm an enable/disable flip before it changes routing for new leads
    // (GAP-CRM-ASSIGNMENT-RULES-05). Brand-new rows (no origEnabled) skip this.
    if (row.id && row.origEnabled !== undefined && row.origEnabled !== row.enabled) {
      setToggleConfirmKey(row.key);
      return;
    }
    await doSave(row);
  }

  async function doSave(row: RuleRow) {
    const rule = toRule(row);
    setBusyKey(row.key);
    try {
      if (row.id) await updateAssignmentRule(row.id, rule);
      else await createAssignmentRule(rule);
      setMessage(`Rule “${rule.name}” saved.`);
      const { ok } = await load();
      // Keep the just-saved row's edits visible if the reload itself failed.
      if (!ok) {
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, origEnabled: row.enabled } : r)),
        );
      }
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
  const toggleRow = rows.find((r) => r.key === toggleConfirmKey) ?? null;
  const dupOrdinals = duplicateOrdinals(rows);
  const hasDup = dupOrdinals.size > 0;
  const isError = source === "error";

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>Assignment rules</h3>
        {isError ? <DataSourceBadge source="error" /> : null}
      </div>
      {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
      {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}

      {isError ? (
        // GAP-CRM-ASSIGNMENT-RULES-03: on a failed load never render an empty
        // chain — an admin must not build a second chain over one they can't
        // see. Show a clerk-safe error with a Retry that re-runs the client
        // fetch (router.refresh would not), and no Add affordance below.
        <div style={{ padding: 12 }}>
          <ErrorState error={toHumanError("load", { area: "assignment rules" })} onRetry={() => void load()} />
        </div>
      ) : rows.length === 0 ? (
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
              <th>{t("lastChanged")}</th>
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
                const parsedCriteria = parseCriteria(row.criteriaText);
                const cErr = criteriaError(row, t);
                const criteriaOk = cErr === null;
                const busy = busyKey === row.key;
                return (
                  <tr key={row.key}>
                    <td className="num">
                      <label className="sr-only" htmlFor={`${headingId}-ord-${row.key}`}>Order for rule {n}</label>
                      <input
                        id={`${headingId}-ord-${row.key}`}
                        type="number" min={0} step={1}
                        value={Number.isInteger(row.ordinal) ? row.ordinal : ""}
                        aria-invalid={!Number.isInteger(row.ordinal) || dupOrdinals.has(row.ordinal) ? true : undefined}
                        aria-describedby={dupOrdinals.has(row.ordinal) ? `${headingId}-ord-err-${row.key}` : undefined}
                        onChange={(e) => update(row.key, { ordinal: sanitizeInt(e.target.value) })}
                        style={{ ...inputStyle, width: 60, textAlign: "end" }}
                      />
                      {dupOrdinals.has(row.ordinal) ? (
                        <p id={`${headingId}-ord-err-${row.key}`} role="alert" style={{ fontSize: 11, color: "#b42318", margin: "4px 0 0" }}>
                          {t("orderAlreadyUsedBy", { name: ownerOfOrdinal(rows, row.key, row.ordinal) ?? t("anotherRule") })}
                        </p>
                      ) : null}
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
                        {RULE_TYPES.map((rt) => <option key={rt} value={rt}>{RULE_TYPE_LABELS[rt]}</option>)}
                      </select>
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-crit-${row.key}`}>Criteria JSON for rule {n}</label>
                      <input
                        id={`${headingId}-crit-${row.key}`}
                        value={row.criteriaText}
                        aria-invalid={criteriaOk ? undefined : true}
                        aria-describedby={criteriaOk ? undefined : `${headingId}-crit-err-${row.key}`}
                        onChange={(e) => update(row.key, { criteriaText: e.target.value })}
                        placeholder='{"territory":"west","ownerId":"…"}'
                        style={{ ...inputStyle, minWidth: 160 }}
                      />
                      {criteriaOk ? (
                        parsedCriteria ? (
                          <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0" }}>
                            {summariseCriteria(row.ruleType, parsedCriteria)}
                          </p>
                        ) : null
                      ) : (
                        <p
                          id={`${headingId}-crit-err-${row.key}`}
                          role="alert"
                          style={{ fontSize: 11, color: "#b42318", margin: "4px 0 0" }}
                        >
                          {cErr}
                        </p>
                      )}
                    </td>
                    <td>
                      <label className="sr-only" htmlFor={`${headingId}-fb-${row.key}`}>Fallback owner for rule {n}</label>
                      <OwnerPicker
                        id={`${headingId}-fb-${row.key}`}
                        aria-label={t("fallbackOwnerForRule", { n })}
                        value={row.fallbackOwner}
                        onChange={(owner) => update(row.key, { fallbackOwner: owner })}
                        placeholder={t("searchOwnerPlaceholder")}
                      />
                    </td>
                    <td>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.key, { enabled: e.target.checked })} aria-label={`Enable rule ${n}`} />
                        {row.enabled ? "On" : "Off"}
                      </label>
                    </td>
                    <td>
                      {/* GAP-CRM-ASSIGNMENT-RULES-05: show real change history when
                          the backend returns it; never fabricate one. */}
                      {row.updatedAt || row.updatedBy ? (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>
                          {row.updatedBy ? t("byUser", { name: row.updatedBy }) : ""}
                          {row.updatedBy && row.updatedAt ? " · " : ""}
                          {row.updatedAt ? formatIndianDateTime(row.updatedAt) : ""}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Button type="button" variant="ghost" size="sm" onClick={() => void move(row, "up")} disabled={busy || i === 0 || !row.id} aria-label={t("moveRuleUp", { n })}>
                          ↑
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => void move(row, "down")} disabled={busy || i === rows.length - 1 || !row.id} aria-label={t("moveRuleDown", { n })}>
                          ↓
                        </Button>
                        <Button type="button" size="sm" onClick={() => void saveRow(row)} disabled={busy || hasDup}>
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
      )}

      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        {!isError ? <Button type="button" variant="ghost" onClick={addRule}>+ Add rule</Button> : null}
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

      <ConfirmDialog
        open={toggleRow !== null}
        title={toggleRow ? t(toggleRow.enabled ? "turnRuleOn" : "turnRuleOff", { name: toggleRow.name || t("unnamed") }) : ""}
        description={
          toggleRow
            ? toggleRow.enabled
              ? t("toggleOnDescription")
              : t("toggleOffDescription")
            : ""
        }
        confirmLabel={toggleRow?.enabled ? t("turnOn") : t("turnOff")}
        busy={toggleRow ? busyKey === toggleRow.key : false}
        onCancel={() => setToggleConfirmKey(null)}
        onConfirm={() => {
          if (!toggleRow) return;
          setToggleConfirmKey(null);
          void doSave(toggleRow);
        }}
      />
    </div>
  );
}
