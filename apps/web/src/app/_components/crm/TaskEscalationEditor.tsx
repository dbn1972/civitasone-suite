"use client";
/**
 * TaskEscalationEditor — AC-005 (config). CRUD the rules that escalate a task
 * left overdue past a threshold to a manager. Each row needs a name, a positive
 * whole threshold in minutes and a manager (role or specific user), so an invalid
 * row is blocked from saving. Rows are created (POST), updated (PUT) or deleted
 * (DELETE, governed via ConfirmDialog) individually. A failed load shows the
 * saved-info badge, never an empty rule-set presented as fact.
 *
 * GAP-CRM-TASK-ESCALATION-01: the manager is picked, never typed. The role and
 * user pickers are fed by crm-service's staff directory (open to CRM admins, not
 * just platform admins), the rule is sent in the shape crm-service accepts
 * (name + recipientRole/recipientId), each saved rule shows the manager's
 * resolved name (or flags one that no longer exists), and the preview line says
 * how many tasks are overdue by at least that rule's threshold RIGHT NOW (a
 * server count with the scheduler's arithmetic, not the length of a capped page).
 * The server stays authoritative: it re-verifies the recipient and its refusal is
 * shown in plain words.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import {
  getTaskEscalationRules,
  createTaskEscalationRule,
  updateTaskEscalationRule,
  deleteTaskEscalationRule,
  getEscalationRoles,
  getEscalationUsers,
  getOverdueMatchCount,
  TaskEscalationRuleRejected,
  type TaskEscalationRule,
  type EscalationRole,
  type EscalationUser,
  type AaSource,
} from "@/lib/crm/activityAccount";

interface Row extends TaskEscalationRule {
  key: string;
  /** Display unit for the threshold input (GAP-CRM-TASK-ESCALATION-05). */
  unit: Unit;
}
let SEQ = 0;
function toRow(r: TaskEscalationRule): Row {
  return { ...r, key: r.id ?? `new-${SEQ++}`, unit: naturalUnit(r.thresholdMinutes) };
}

const MAX_NAME_LENGTH = 200;

function rowValid(r: Row): boolean {
  return (
    (r.name ?? "").trim().length > 0 &&
    Number.isInteger(r.thresholdMinutes) &&
    r.thresholdMinutes > 0 &&
    (r.managerRole.trim().length > 0 || r.managerId.trim().length > 0)
  );
}

/** Threshold units offered in the editor (GAP-CRM-TASK-ESCALATION-05). */
const UNITS = ["minutes", "hours", "days"] as const;
type Unit = (typeof UNITS)[number];
const UNIT_KEYS = { minutes: "unitMinutes", hours: "unitHours", days: "unitDays" } as const;
const UNIT_FACTOR: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };
/** 1 year in minutes — an upper bound so a typo can't set an absurd threshold. */
const MAX_THRESHOLD_MINUTES = 525600;
/** Wait for a threshold to settle before asking the server how many tasks it matches. */
const PREVIEW_DEBOUNCE_MS = 300;

/** Pick the most natural unit for a stored minute count (exact day > exact hour > minutes). */
function naturalUnit(minutes: number): Unit {
  if (Number.isInteger(minutes) && minutes > 0 && minutes % 1440 === 0) return "days";
  if (Number.isInteger(minutes) && minutes > 0 && minutes % 60 === 0) return "hours";
  return "minutes";
}
/** Human echo of a minute count, e.g. "= 1 day", "= 2 hours". */
function echoThreshold(minutes: number, t: ReturnType<typeof useTranslations>): string {
  if (!Number.isInteger(minutes) || minutes <= 0) return "";
  if (minutes % 1440 === 0) return t("echoDays", { count: minutes / 1440 });
  if (minutes % 60 === 0) return t("echoHours", { count: minutes / 60 });
  return t("echoMinutes", { count: minutes });
}

const inputStyle = { padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", width: "100%" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export function TaskEscalationEditor() {
  const t = useTranslations("crmTaskEscalationEditor");
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // GAP-CRM-TASK-ESCALATION-01: the tenant's roles + users back the pickers so a
  // rule can only target a real role / user. If either directory cannot be read the
  // pickers would be silently empty, so say so instead.
  const [roles, setRoles] = useState<EscalationRole[]>([]);
  const [users, setUsers] = useState<EscalationUser[]>([]);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  // Overdue tasks matching each distinct threshold (minutes) -> count, or "error".
  const [matchCounts, setMatchCounts] = useState<Record<number, number | "error">>({});
  const requestedThresholds = useRef(new Set<number>());
  const mounted = useRef(true);
  const headingId = useId();

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getTaskEscalationRules();
    if (!isLive()) return;
    setRows(data.map(toRow));
    setSource(s);
  }

  useEffect(() => {
    mounted.current = true;
    let live = true;
    void load(() => live);
    void Promise.all([getEscalationRoles(), getEscalationUsers()]).then(([r, u]) => {
      if (!live) return;
      setRoles(r.data);
      setUsers(u.data);
      setDirectoryFailed(r.source === "error" || u.source === "error");
    });
    return () => {
      live = false;
      mounted.current = false;
    };
  }, []);

  // Ask the server how many tasks each distinct, valid threshold matches right now.
  const thresholds = useMemo(
    () => [
      ...new Set(
        rows
          .map((r) => r.thresholdMinutes)
          .filter((m) => Number.isInteger(m) && m > 0 && m <= MAX_THRESHOLD_MINUTES),
      ),
    ],
    [rows],
  );
  useEffect(() => {
    const missing = thresholds.filter((m) => !requestedThresholds.current.has(m));
    if (missing.length === 0) return;
    const timer = setTimeout(() => {
      for (const minutes of missing) {
        if (requestedThresholds.current.has(minutes)) continue;
        requestedThresholds.current.add(minutes);
        void getOverdueMatchCount(minutes).then((res) => {
          if (!mounted.current) return;
          setMatchCounts((prev) => ({ ...prev, [minutes]: res.source === "error" ? "error" : res.data }));
        });
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [thresholds]);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRule() {
    setRows((prev) => [
      ...prev,
      toRow({ name: t("defaultRuleName"), thresholdMinutes: 1440, managerRole: "", managerId: "", enabled: true }),
    ]);
  }

  /** Display name for a saved rule's manager, flagging one that no longer exists. */
  function managerSummary(row: Row): { text: string; missing: boolean } {
    if (row.managerId.trim()) {
      const u = users.find((x) => x.id === row.managerId.trim());
      return u ? { text: u.name, missing: false } : { text: t("unknownUser"), missing: true };
    }
    if (row.managerRole.trim()) {
      const r = roles.find((x) => x.key === row.managerRole.trim());
      return r ? { text: r.label, missing: false } : { text: t("unknownRole", { role: row.managerRole.trim() }), missing: true };
    }
    return { text: t("noManager"), missing: true };
  }

  async function saveRow(row: Row) {
    setMessage("");
    setError("");
    if (!rowValid(row)) {
      setError(t("rowInvalid"));
      return;
    }
    if (row.thresholdMinutes > MAX_THRESHOLD_MINUTES) {
      setError(t("thresholdTooLarge", { max: MAX_THRESHOLD_MINUTES }));
      return;
    }
    // GAP-CRM-TASK-ESCALATION-05: block two enabled rules that share the same
    // threshold AND manager — their behaviour would be ambiguous/duplicated.
    const mgr = (r: Row) => `${r.managerRole.trim()}|${r.managerId.trim()}`;
    const clash =
      row.enabled &&
      rows.some(
        (r) => r.key !== row.key && r.enabled && r.thresholdMinutes === row.thresholdMinutes && mgr(r) === mgr(row),
      );
    if (clash) {
      setError(t("duplicateThreshold"));
      return;
    }
    const rule: TaskEscalationRule = {
      ...(row.id ? { id: row.id } : {}),
      name: (row.name ?? "").trim(),
      ...(row.appliesTo ? { appliesTo: row.appliesTo } : {}),
      thresholdMinutes: row.thresholdMinutes,
      managerRole: row.managerRole.trim(),
      managerId: row.managerId.trim(),
      enabled: row.enabled,
    };
    setBusyKey(row.key);
    try {
      if (row.id) await updateTaskEscalationRule(row.id, rule);
      else await createTaskEscalationRule(rule);
      setMessage(t("saved"));
      await load();
    } catch (e) {
      // The server verifies the manager itself; word its refusal precisely.
      if (e instanceof TaskEscalationRuleRejected) setError(t(`rejected.${e.code}`));
      else setError(e instanceof Error && e.message ? e.message : t("saveFailed"));
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
      setMessage(t("deleted"));
      setConfirmKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("deleteFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  if (source === "loading") {
    return <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>{t("loading")}</p>;
  }

  const confirmRow = rows.find((r) => r.key === confirmKey) ?? null;

  return (
    <div className="card">
      <div className="card-h">
        <h3 id={headingId}>{t("heading")}</h3>
        {source === "error" ? <DataSourceBadge source="error" /> : null}
      </div>
      <div className="pad" style={{ display: "grid", gap: 12 }}>
        {directoryFailed ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>{t("directoryUnavailable")}</p>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState icon="⏰" title={t("emptyTitle")} message={t("emptyMessage")} />
        ) : (
          // GAP-CRM-TASK-ESCALATION-05: show rules in ascending threshold order
          // so the escalation ladder reads top-to-bottom. Each rule fires
          // independently (backend does not cascade), stated in the help text.
          rows
            .slice()
            .sort((a, b) => (a.thresholdMinutes || 0) - (b.thresholdMinutes || 0))
            .map((row, i) => {
            const summary = managerSummary(row);
            const count = matchCounts[row.thresholdMinutes];
            return (
            <fieldset key={row.key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "grid", gap: 10, margin: 0 }}>
              <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", padding: "0 6px" }}>{t("ruleLegend", { n: i + 1 })}</legend>
              <div>
                <label htmlFor={`${row.key}-nm`} style={labelStyle}>{t("ruleName")}</label>
                <input
                  id={`${row.key}-nm`}
                  aria-label={t("ruleNameAria", { n: i + 1 })}
                  type="text"
                  maxLength={MAX_NAME_LENGTH}
                  value={row.name ?? ""}
                  onChange={(e) => update(row.key, { name: e.target.value })}
                  aria-invalid={(row.name ?? "").trim() ? undefined : true}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  {/* GAP-CRM-TASK-ESCALATION-05: enter the threshold in a chosen
                      unit (minutes/hours/days); it converts to thresholdMinutes
                      and echoes the stored value so there is no hidden unit. */}
                  <label htmlFor={`${row.key}-th`} style={labelStyle}>{t("overdueBy")}</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      id={`${row.key}-th`}
                      aria-label={t("thresholdValueAria", { n: i + 1 })}
                      type="number"
                      min={1}
                      value={
                        Number.isNaN(row.thresholdMinutes) || !Number.isFinite(row.thresholdMinutes)
                          ? ""
                          : row.thresholdMinutes / UNIT_FACTOR[row.unit]
                      }
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        const mins = Number.isFinite(v) && v > 0 ? Math.round(v * UNIT_FACTOR[row.unit]) : Number.NaN;
                        update(row.key, { thresholdMinutes: mins });
                      }}
                      aria-invalid={rowValid(row) ? undefined : true}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <select
                      aria-label={t("thresholdUnitAria", { n: i + 1 })}
                      value={row.unit}
                      onChange={(e) => update(row.key, { unit: e.target.value as Unit })}
                      style={{ ...inputStyle, width: 110 }}
                    >
                      {UNITS.map((u) => <option key={u} value={u}>{t(UNIT_KEYS[u])}</option>)}
                    </select>
                  </div>
                  {echoThreshold(row.thresholdMinutes, t) ? (
                    <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0" }}>{echoThreshold(row.thresholdMinutes, t)}</p>
                  ) : null}
                </div>
                <div>
                  {/* GAP-CRM-TASK-ESCALATION-01: a SELECT fed by the tenant's
                      roles, not free text — a mistyped role can no longer save
                      and escalate to nobody. Clearing the role is allowed (so a
                      user-targeted rule can drop it). */}
                  <label htmlFor={`${row.key}-mr`} style={labelStyle}>{t("managerRole")}</label>
                  <select
                    id={`${row.key}-mr`}
                    aria-label={t("managerRoleAria", { n: i + 1 })}
                    value={row.managerRole}
                    onChange={(e) => update(row.key, { managerRole: e.target.value })}
                    aria-invalid={row.managerRole.trim() || row.managerId.trim() ? undefined : true}
                    style={inputStyle}
                  >
                    <option value="">{t("noRole")}</option>
                    {/* Keep a saved-but-unknown role selectable so an existing
                        rule referencing a deleted role still round-trips and is
                        flagged below rather than silently cleared. */}
                    {row.managerRole && !roles.some((r) => r.key === row.managerRole) && (
                      <option value={row.managerRole}>{t("unknownRole", { role: row.managerRole })}</option>
                    )}
                    {roles.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  {/* A searchable user picker (SELECT over the tenant directory)
                      storing the user id, not free text. */}
                  <label htmlFor={`${row.key}-mi`} style={labelStyle}>{t("managerUser")}</label>
                  <select
                    id={`${row.key}-mi`}
                    aria-label={t("managerUserAria", { n: i + 1 })}
                    value={row.managerId}
                    onChange={(e) => update(row.key, { managerId: e.target.value })}
                    aria-invalid={row.managerRole.trim() || row.managerId.trim() ? undefined : true}
                    style={inputStyle}
                  >
                    <option value="">{t("noSpecificUser")}</option>
                    {row.managerId && !users.some((u) => u.id === row.managerId) && (
                      <option value={row.managerId}>{t("unknownUser")}</option>
                    )}
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Resolved manager name + a preview of what the rule will do. The count is the
                  number of tasks overdue by at least THIS rule's threshold right now. */}
              <p style={{ fontSize: 12, margin: 0, color: summary.missing ? "#b42318" : "var(--muted)" }}>
                {summary.missing
                  ? t.rich("escalatesMissing", { name: summary.text, strong: (chunks) => <strong>{chunks}</strong> })
                  : typeof count === "number"
                    ? t.rich("escalatesWithCount", {
                        name: summary.text,
                        count,
                        formatted: count.toLocaleString("en-IN"),
                        strong: (chunks) => <strong>{chunks}</strong>,
                      })
                    : t.rich("escalates", { name: summary.text, strong: (chunks) => <strong>{chunks}</strong> })}
              </p>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={row.enabled} aria-label={t("enableAria", { n: i + 1 })} onChange={(e) => update(row.key, { enabled: e.target.checked })} />
                {t("enabled")}
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <Button type="button" disabled={busyKey === row.key} onClick={() => void saveRow(row)} style={{ minHeight: 40 }}>
                  {busyKey === row.key ? t("saving") : row.id ? t("save") : t("create")}
                </Button>
                <Button type="button" variant="danger" aria-label={t("deleteAria", { n: i + 1 })} disabled={busyKey === row.key} onClick={() => setConfirmKey(row.key)} style={{ minHeight: 40 }}>
                  {t("delete")}
                </Button>
              </div>
            </fieldset>
            );
          })
        )}
        <div>
          <Button type="button" onClick={addRule} style={{ minHeight: 44 }}>{t("addRule")}</Button>
        </div>
        {rows.length > 0 ? (
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
            {t("rulesListedHelp")}
          </p>
        ) : null}
        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>{error}</p> : null}
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("deleteConfirm")}
        danger
        busy={busyKey !== null && confirmRow?.key === busyKey}
        onCancel={() => setConfirmKey(null)}
        onConfirm={() => confirmRow && void confirmDelete(confirmRow)}
      />
    </div>
  );
}
