"use client";

/**
 * P0-6 — decisions and action-item tracking for a meeting.
 *
 * Wires the existing meeting-service endpoints (action-item/routes.ts, decision/routes.ts) into the
 * meeting console so the resolution -> action item -> evidence -> verify leg can be driven in the
 * product. Writes are queued (202) and applied by a consumer, so after each write the lists are
 * re-fetched a few times instead of being mutated optimistically.
 *
 * Role gates (viewer*) only hide controls the server would refuse; the server stays the authority.
 * Acknowledge / progress / evidence are additionally limited to the assignee because the consumer
 * silently drops them for anyone else (action-item/consumer.ts "is not the assignee").
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState, ErrorState } from "@/app/_components/ds";
import { EmployeePicker } from "@/app/_components/EmployeePicker";
import type { HumanError } from "@/lib/messages";
import { unresolvedLabel, type PersonRef } from "@/lib/records/labels";
import { actionErrorText } from "../../_data/errorText";
import { fmtDateTime, humanize } from "../../_data/format";
import {
  acknowledgeActionItem,
  assignActionItem,
  fetchActionItems,
  fetchDecisions,
  recordDecision,
  submitActionEvidence,
  submitActionProgress,
  updateActionItem,
  verifyActionItem,
  withdrawDecision,
} from "../../_data/client";
import {
  ACTION_PRIORITIES,
  DECISION_TYPES,
  type ActionItem,
  type ActionItemPatch,
  type ActionPriority,
  type AgendaItem,
  type Decision,
  type DecisionType,
} from "../../_data/types";

type Src = "api" | "error" | string;

export type ActionPermissions = {
  canAssign: boolean;
  canUpdate: boolean;
  canAssigneeAct: boolean;
  canVerify: boolean;
  canRecordDecision: boolean;
  employeeDirectory?: "hrms" | "payroll" | "none";
};

type Props = {
  meetingId: string;
  actionItems: ActionItem[];
  actionItemsSource: Src;
  decisions: Decision[];
  decisionsSource: Src;
  agenda: AgendaItem[];
  people?: Record<string, PersonRef>;
  /** The signed-in employee/user id, used to tell whether the viewer is an item's assignee. */
  viewerId: string | null;
  permissions: ActionPermissions;
};

const SETTLED = ["completed", "verified", "withdrawn"];
const PROGRESS_STATES = ["assigned", "acknowledged", "in_progress", "overdue", "escalated"];

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "left",
};
const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  fontFamily: "inherit",
};
const formStyle: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 };

const LOAD_ERROR: HumanError = {
  what: "This list couldn't be loaded.",
  next: "Live data couldn't be reached. Try again in a moment.",
  actions: ["retry"],
};

/** `<input type="datetime-local">` value -> RFC-3339 with offset, as the service requires. */
function toIso(local: string): string {
  return new Date(local).toISOString();
}

/** RFC-3339 -> `datetime-local` input value (local time, minute precision). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type DecisionRow = {
  id: string;
  text: string;
  typeLabel: string;
  status: string;
  officer: string;
  deadlineLabel: string;
};
type ActionRow = {
  id: string;
  description: string;
  assignee: string;
  deadlineLabel: string;
  priorityLabel: string;
  status: string;
};

export function ActionsDecisionsPanel({
  meetingId,
  actionItems: initialActions,
  actionItemsSource,
  decisions: initialDecisions,
  decisionsSource,
  agenda,
  people = {},
  viewerId,
  permissions,
}: Props) {
  const t = useTranslations("meetingActions");
  const [actions, setActions] = useState(initialActions);
  const [decisions, setDecisions] = useState(initialDecisions);
  const [actionsState, setActionsState] = useState<Src>(actionItemsSource);
  const [decisionsState, setDecisionsState] = useState<Src>(decisionsSource);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const label = useCallback(
    (group: string, value: string) => (t.has(`${group}.${value}`) ? t(`${group}.${value}`) : humanize(value)),
    [t],
  );
  const who = useCallback(
    (id: string | null) => {
      if (!id) return "—";
      const ref = people[id];
      return ref ? (ref.designation ? `${ref.name}, ${ref.designation}` : ref.name) : unresolvedLabel(id);
    },
    [people],
  );

  const refresh = useCallback(async () => {
    const [a, d] = await Promise.allSettled([fetchActionItems(meetingId), fetchDecisions(meetingId)]);
    if (a.status === "fulfilled") {
      setActions(a.value);
      setActionsState("api");
    } else setActionsState("error");
    if (d.status === "fulfilled") {
      setDecisions(d.value);
      setDecisionsState("api");
    } else setDecisionsState("error");
  }, [meetingId]);

  /** Queued writes land a moment later; re-read right away and twice more. */
  const refreshSoon = useCallback(() => {
    void refresh();
    timers.current.push(setTimeout(() => void refresh(), 1500), setTimeout(() => void refresh(), 4000));
  }, [refresh]);

  async function run(key: string, doneMessage: string, fn: () => Promise<void>, after?: () => void) {
    setBusy(key);
    setError(null);
    setToast(null);
    try {
      await fn();
      setToast(doneMessage);
      after?.();
      refreshSoon();
    } catch (err) {
      setError(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  // ── decision form ──────────────────────────────────────────────────────────
  const [dText, setDText] = useState("");
  const [dType, setDType] = useState<DecisionType>("general");
  const [dAgenda, setDAgenda] = useState("");
  const [dOfficer, setDOfficer] = useState<string | null>(null);
  const [dDeadline, setDDeadline] = useState("");

  function onRecordDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!dText.trim()) return;
    void run(
      "decision:record",
      t("decisionRecorded"),
      () =>
        recordDecision(meetingId, {
          text: dText.trim(),
          type: dType,
          ...(dAgenda ? { agendaItemId: dAgenda } : {}),
          ...(dOfficer ? { responsibleOfficer: dOfficer } : {}),
          ...(dDeadline ? { deadline: toIso(dDeadline) } : {}),
        }),
      () => {
        setDText("");
        setDAgenda("");
        setDOfficer(null);
        setDDeadline("");
      },
    );
  }

  // ── action-item form ───────────────────────────────────────────────────────
  const [aDesc, setADesc] = useState("");
  const [aAssignee, setAAssignee] = useState<string | null>(null);
  const [aDeadline, setADeadline] = useState("");
  const [aPriority, setAPriority] = useState<ActionPriority>("medium");
  const [aDecision, setADecision] = useState("");
  const [aAgenda, setAAgenda] = useState("");
  const [aEvidence, setAEvidence] = useState("");

  function onAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!aDesc.trim() || !aAssignee || !aDeadline) return;
    void run(
      "action:assign",
      t("actionAssigned"),
      () =>
        assignActionItem(meetingId, {
          description: aDesc.trim(),
          assigneeId: aAssignee,
          deadline: toIso(aDeadline),
          priority: aPriority,
          ...(aDecision ? { decisionId: aDecision } : {}),
          ...(aAgenda ? { agendaItemId: aAgenda } : {}),
          ...(aEvidence.trim() ? { expectedEvidence: aEvidence.trim() } : {}),
        }),
      () => {
        setADesc("");
        setAAssignee(null);
        setADeadline("");
        setAPriority("medium");
        setADecision("");
        setAAgenda("");
        setAEvidence("");
      },
    );
  }

  const selected = actions.find((a) => a.id === selectedId) ?? null;

  const decisionRows: DecisionRow[] = decisions.map((d) => ({
    id: d.id,
    text: d.text,
    typeLabel: label("decisionType", d.type),
    status: d.status,
    officer: who(d.responsibleOfficer),
    deadlineLabel: d.deadline ? fmtDateTime(d.deadline) : "—",
  }));
  const actionRows: ActionRow[] = actions.map((a) => ({
    id: a.id,
    description: a.description,
    assignee: who(a.assigneeId),
    deadlineLabel: fmtDateTime(a.deadline),
    priorityLabel: label("priority", a.priority),
    status: a.status,
  }));

  const directoryOk = permissions.employeeDirectory !== "none";

  return (
    <>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}
      {error && (
        <div className="alert" role="alert" style={{ borderColor: "var(--badbd)", color: "var(--bad)" }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Decisions ─────────────────────────────────────────────────────── */}
      <div id="section-decisions">
        <Card title={t("decisionsTitle", { count: decisionsState === "error" ? "—" : decisions.length })} padding>
          {decisionsState === "error" ? (
            <ErrorState error={LOAD_ERROR} onRetry={() => void refresh()} />
          ) : decisions.length === 0 ? (
            <EmptyState icon="⚖️" title={t("decisionsEmptyTitle")} message={t("decisionsEmptyMessage")} />
          ) : (
            <DataTable<DecisionRow>
              columns={[
                { key: "text", label: t("colDecision") },
                { key: "typeLabel", label: t("colType") },
                { key: "officer", label: t("colOfficer") },
                { key: "deadlineLabel", label: t("colDeadline") },
                { key: "status", label: t("colStatus"), cellType: "status" },
                ...(permissions.canRecordDecision
                  ? [
                      {
                        key: "id" as const,
                        label: t("colActions"),
                        render: (row: DecisionRow) => {
                          const d = decisions.find((x) => x.id === row.id);
                          if (!d || d.status !== "effective") return null;
                          return (
                            <button
                              type="button"
                              className="btn ghost"
                              disabled={busy !== null}
                              onClick={() =>
                                void run(`decision:withdraw:${d.id}`, t("decisionWithdrawn"), () =>
                                  withdrawDecision(meetingId, d.id, d.version),
                                )
                              }
                            >
                              {busy === `decision:withdraw:${d.id}` ? "…" : t("withdraw")}
                            </button>
                          );
                        },
                      },
                    ]
                  : []),
              ]}
              rows={decisionRows}
              identifyingColumnKey="text"
              emptyTitle={t("decisionsEmptyTitle")}
            />
          )}

          {permissions.canRecordDecision && (
            <form onSubmit={onRecordDecision} style={formStyle} aria-label={t("recordDecision")}>
              <div style={{ flex: "2 1 300px" }}>
                <label htmlFor="mtg-dec-text" style={labelStyle}>{t("decisionText")}</label>
                <textarea
                  id="mtg-dec-text"
                  style={fieldStyle}
                  rows={2}
                  maxLength={20000}
                  value={dText}
                  placeholder={t("decisionTextPlaceholder")}
                  onChange={(e) => setDText(e.target.value)}
                />
              </div>
              <div style={{ flex: "1 1 150px" }}>
                <label htmlFor="mtg-dec-type" style={labelStyle}>{t("colType")}</label>
                <select id="mtg-dec-type" style={fieldStyle} value={dType} onChange={(e) => setDType(e.target.value as DecisionType)}>
                  {DECISION_TYPES.map((x) => (
                    <option key={x} value={x}>{label("decisionType", x)}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label htmlFor="mtg-dec-agenda" style={labelStyle}>{t("linkedAgenda")}</label>
                <select id="mtg-dec-agenda" style={fieldStyle} value={dAgenda} onChange={(e) => setDAgenda(e.target.value)}>
                  <option value="">{t("none")}</option>
                  {agenda.map((a) => (
                    <option key={a.id} value={a.id}>{a.sequence}. {a.title}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: "1 1 190px" }}>
                <label htmlFor="mtg-dec-deadline" style={labelStyle}>{t("colDeadline")}</label>
                <input id="mtg-dec-deadline" type="datetime-local" style={fieldStyle} value={dDeadline} onChange={(e) => setDDeadline(e.target.value)} />
              </div>
              {directoryOk && (
                <div style={{ flex: "1 1 240px" }}>
                  <div style={labelStyle}>{t("colOfficer")}</div>
                  <EmployeePicker
                    value={dOfficer}
                    onChange={(id) => setDOfficer(id)}
                    aria-label={t("colOfficer")}
                    directory={permissions.employeeDirectory ?? "hrms"}
                    clearable
                  />
                </div>
              )}
              <button type="submit" className="btn" disabled={busy !== null || dText.trim() === ""}>
                {busy === "decision:record" ? "…" : t("recordDecision")}
              </button>
            </form>
          )}
        </Card>
      </div>

      {/* ── Action items ──────────────────────────────────────────────────── */}
      <div id="section-actions">
        <Card title={t("actionsTitle", { count: actionsState === "error" ? "—" : actions.length })} padding>
          {actionsState === "error" ? (
            <ErrorState error={LOAD_ERROR} onRetry={() => void refresh()} />
          ) : actions.length === 0 ? (
            <EmptyState icon="✅" title={t("actionsEmptyTitle")} message={t("actionsEmptyMessage")} />
          ) : (
            <DataTable<ActionRow>
              columns={[
                { key: "description", label: t("colAction") },
                { key: "assignee", label: t("colAssignee") },
                { key: "deadlineLabel", label: t("colDeadline") },
                { key: "priorityLabel", label: t("colPriority") },
                { key: "status", label: t("colStatus"), cellType: "status" },
                {
                  key: "id",
                  label: t("colActions"),
                  render: (row: ActionRow) => (
                    <button
                      type="button"
                      className="btn ghost"
                      aria-pressed={selectedId === row.id}
                      onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                    >
                      {selectedId === row.id ? t("close") : t("manage")}
                    </button>
                  ),
                },
              ]}
              rows={actionRows}
              identifyingColumnKey="description"
              emptyTitle={t("actionsEmptyTitle")}
            />
          )}

          {selected && (
            <ActionDetail
              key={`${selected.id}:${selected.version}:${selected.status}`}
              item={selected}
              assigneeName={who(selected.assigneeId)}
              verifierName={who(selected.verifiedBy)}
              statusLabel={label("status", selected.status)}
              viewerId={viewerId}
              permissions={permissions}
              busy={busy}
              run={run}
              label={label}
            />
          )}

          {permissions.canAssign &&
            (directoryOk ? (
              <form onSubmit={onAssign} style={formStyle} aria-label={t("assignAction")}>
                <div style={{ flex: "2 1 300px" }}>
                  <label htmlFor="mtg-act-desc" style={labelStyle}>{t("actionDescription")}</label>
                  <textarea
                    id="mtg-act-desc"
                    style={fieldStyle}
                    rows={2}
                    maxLength={20000}
                    value={aDesc}
                    placeholder={t("actionDescriptionPlaceholder")}
                    onChange={(e) => setADesc(e.target.value)}
                  />
                </div>
                <div style={{ flex: "1 1 240px" }}>
                  <div style={labelStyle}>{t("colAssignee")}</div>
                  <EmployeePicker
                    value={aAssignee}
                    onChange={(id) => setAAssignee(id)}
                    aria-label={t("colAssignee")}
                    directory={permissions.employeeDirectory ?? "hrms"}
                    clearable
                  />
                </div>
                <div style={{ flex: "1 1 190px" }}>
                  <label htmlFor="mtg-act-deadline" style={labelStyle}>{t("colDeadline")}</label>
                  <input id="mtg-act-deadline" type="datetime-local" style={fieldStyle} value={aDeadline} onChange={(e) => setADeadline(e.target.value)} />
                </div>
                <div style={{ flex: "1 1 130px" }}>
                  <label htmlFor="mtg-act-priority" style={labelStyle}>{t("colPriority")}</label>
                  <select id="mtg-act-priority" style={fieldStyle} value={aPriority} onChange={(e) => setAPriority(e.target.value as ActionPriority)}>
                    {ACTION_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{label("priority", p)}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 220px" }}>
                  <label htmlFor="mtg-act-decision" style={labelStyle}>{t("linkedDecision")}</label>
                  <select id="mtg-act-decision" style={fieldStyle} value={aDecision} onChange={(e) => setADecision(e.target.value)}>
                    <option value="">{t("none")}</option>
                    {decisions.map((d) => (
                      <option key={d.id} value={d.id}>{d.text.length > 70 ? `${d.text.slice(0, 70)}…` : d.text}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <label htmlFor="mtg-act-agenda" style={labelStyle}>{t("linkedAgenda")}</label>
                  <select id="mtg-act-agenda" style={fieldStyle} value={aAgenda} onChange={(e) => setAAgenda(e.target.value)}>
                    <option value="">{t("none")}</option>
                    {agenda.map((a) => (
                      <option key={a.id} value={a.id}>{a.sequence}. {a.title}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 260px" }}>
                  <label htmlFor="mtg-act-evidence" style={labelStyle}>{t("expectedEvidence")}</label>
                  <input
                    id="mtg-act-evidence"
                    style={fieldStyle}
                    maxLength={4000}
                    value={aEvidence}
                    placeholder={t("expectedEvidencePlaceholder")}
                    onChange={(e) => setAEvidence(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn" disabled={busy !== null || !aDesc.trim() || !aAssignee || !aDeadline}>
                  {busy === "action:assign" ? "…" : t("assignAction")}
                </button>
              </form>
            ) : (
              <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 12 }}>{t("noDirectory")}</p>
            ))}
        </Card>
      </div>
    </>
  );
}

type RunFn = (key: string, doneMessage: string, fn: () => Promise<void>, after?: () => void) => Promise<void>;

function ActionDetail({
  item,
  assigneeName,
  verifierName,
  statusLabel,
  viewerId,
  permissions,
  busy,
  run,
  label,
}: {
  item: ActionItem;
  assigneeName: string;
  verifierName: string;
  statusLabel: string;
  viewerId: string | null;
  permissions: ActionPermissions;
  busy: string | null;
  run: RunFn;
  label: (group: string, value: string) => string;
}) {
  const t = useTranslations("meetingActions");
  const settled = SETTLED.includes(item.status);
  const isAssignee = viewerId !== null && viewerId === item.assigneeId;
  const mayAct = permissions.canAssigneeAct && isAssignee;
  const mayAck = mayAct && item.status === "assigned";
  const mayProgress = mayAct && PROGRESS_STATES.includes(item.status);
  const mayEvidence = mayAct && !settled && item.status !== "evidence_submitted";
  const mayVerify = permissions.canVerify && item.status === "evidence_submitted" && !isAssignee;
  const selfVerifyBlocked = permissions.canVerify && isAssignee && item.status === "evidence_submitted";
  const mayEdit = permissions.canUpdate && !settled;
  const directoryOk = permissions.employeeDirectory !== "none";

  const [pText, setPText] = useState("");
  const [pPct, setPPct] = useState("0");
  const [evUrl, setEvUrl] = useState("");
  const [evNote, setEvNote] = useState("");
  const [vNote, setVNote] = useState("");
  const [eDesc, setEDesc] = useState(item.description);
  const [eDeadline, setEDeadline] = useState(toLocalInput(item.deadline));
  const [ePriority, setEPriority] = useState<ActionPriority>(item.priority as ActionPriority);
  const [eAssignee, setEAssignee] = useState<string | null>(item.assigneeId);

  /** Only the fields the user actually changed (the service rejects an empty patch). */
  function buildPatch(): ActionItemPatch {
    const patch: ActionItemPatch = {};
    if (eDesc.trim() !== item.description) patch.description = eDesc.trim();
    if (eDeadline && toLocalInput(item.deadline) !== eDeadline) patch.deadline = toIso(eDeadline);
    if (ePriority !== item.priority) patch.priority = ePriority;
    if (eAssignee && eAssignee !== item.assigneeId) patch.assigneeId = eAssignee;
    return patch;
  }
  const patch = buildPatch();
  const patchEmpty = Object.keys(patch).length === 0 || eDesc.trim() === "";

  const pct = Number(pPct);
  const pctValid = Number.isInteger(pct) && pct >= 0 && pct <= 100;
  const evUrlOk = evUrl.trim() === "" || /^https?:\/\/\S+$/i.test(evUrl.trim());
  const evEmpty = evUrl.trim() === "" && evNote.trim() === "";

  return (
    <section aria-label={t("detailTitle")} style={{ marginTop: 14, padding: 14, border: "1px solid var(--line)", borderRadius: 10, display: "grid", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 700 }}>{item.description}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>
          {t("detailSummary", {
            assignee: assigneeName,
            status: statusLabel,
            deadline: fmtDateTime(item.deadline),
          })}
        </div>
        {(item.evidenceUrl || item.evidenceNote) && (
          <div style={{ fontSize: 13, marginTop: 6 }}>
            <strong>{t("evidenceSubmitted")}</strong>{" "}
            {item.evidenceNote}
            {item.evidenceUrl && (
              <>
                {" "}
                <a href={item.evidenceUrl} target="_blank" rel="noopener noreferrer">{t("evidenceLink")}</a>
              </>
            )}
          </div>
        )}
        {item.verifiedBy && (
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>
            {t("verifiedBy", { name: verifierName, when: item.verifiedAt ? fmtDateTime(item.verifiedAt) : "—" })}
          </div>
        )}
      </div>

      {!isAssignee && !settled && permissions.canAssigneeAct && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{t("assigneeOnlyHint")}</p>
      )}

      {mayAck && (
        <div>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => void run(`action:ack:${item.id}`, t("acknowledged"), () => acknowledgeActionItem(item.id, item.version))}
          >
            {busy === `action:ack:${item.id}` ? "…" : t("acknowledge")}
          </button>
        </div>
      )}

      {mayProgress && (
        <form
          style={formStyle}
          aria-label={t("recordProgress")}
          onSubmit={(e) => {
            e.preventDefault();
            if (!pText.trim() || !pctValid) return;
            void run(`action:progress:${item.id}`, t("progressRecorded"), () => submitActionProgress(item.id, pText.trim(), pct), () => {
              setPText("");
              setPPct("0");
            });
          }}
        >
          <div style={{ flex: "2 1 280px" }}>
            <label htmlFor="mtg-prog-text" style={labelStyle}>{t("progressNote")}</label>
            <input id="mtg-prog-text" style={fieldStyle} maxLength={10000} value={pText} placeholder={t("progressNotePlaceholder")} onChange={(e) => setPText(e.target.value)} />
          </div>
          <div style={{ flex: "0 1 110px" }}>
            <label htmlFor="mtg-prog-pct" style={labelStyle}>{t("percentComplete")}</label>
            <input id="mtg-prog-pct" type="number" min={0} max={100} step={1} style={fieldStyle} value={pPct} onChange={(e) => setPPct(e.target.value)} />
          </div>
          <button type="submit" className="btn" disabled={busy !== null || !pText.trim() || !pctValid}>
            {busy === `action:progress:${item.id}` ? "…" : t("recordProgress")}
          </button>
        </form>
      )}

      {mayEvidence && (
        <form
          style={formStyle}
          aria-label={t("submitEvidence")}
          onSubmit={(e) => {
            e.preventDefault();
            if (evEmpty || !evUrlOk) return;
            void run(
              `action:evidence:${item.id}`,
              t("evidenceRecorded"),
              () =>
                submitActionEvidence(item.id, {
                  ...(evUrl.trim() ? { evidenceUrl: evUrl.trim() } : {}),
                  ...(evNote.trim() ? { evidenceNote: evNote.trim() } : {}),
                }),
              () => {
                setEvUrl("");
                setEvNote("");
              },
            );
          }}
        >
          <div style={{ flex: "1 1 240px" }}>
            <label htmlFor="mtg-ev-url" style={labelStyle}>{t("evidenceUrl")}</label>
            <input id="mtg-ev-url" type="url" style={fieldStyle} maxLength={2000} value={evUrl} placeholder="https://" onChange={(e) => setEvUrl(e.target.value)} aria-invalid={!evUrlOk} />
          </div>
          <div style={{ flex: "2 1 280px" }}>
            <label htmlFor="mtg-ev-note" style={labelStyle}>{t("evidenceNote")}</label>
            <input id="mtg-ev-note" style={fieldStyle} maxLength={10000} value={evNote} placeholder={t("evidenceNotePlaceholder")} onChange={(e) => setEvNote(e.target.value)} />
          </div>
          <button type="submit" className="btn" disabled={busy !== null || evEmpty || !evUrlOk}>
            {busy === `action:evidence:${item.id}` ? "…" : t("submitEvidence")}
          </button>
        </form>
      )}

      {mayVerify && (
        <div style={formStyle}>
          <div style={{ flex: "2 1 280px" }}>
            <label htmlFor="mtg-verify-note" style={labelStyle}>{t("verifyNote")}</label>
            <input id="mtg-verify-note" style={fieldStyle} maxLength={10000} value={vNote} onChange={(e) => setVNote(e.target.value)} />
          </div>
          {([true, false] as const).map((ok) => (
            <button
              key={String(ok)}
              type="button"
              className={ok ? "btn" : "btn ghost"}
              disabled={busy !== null || viewerId === null}
              onClick={() =>
                void run(`action:verify:${item.id}`, ok ? t("verified") : t("returned"), () =>
                  verifyActionItem(item.id, {
                    verifierId: viewerId as string,
                    verified: ok,
                    ...(vNote.trim() ? { note: vNote.trim() } : {}),
                  }),
                )
              }
            >
              {ok ? t("verify") : t("returnToAssignee")}
            </button>
          ))}
        </div>
      )}

      {selfVerifyBlocked && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{t("selfVerifyHint")}</p>
      )}

      {mayEdit && (
        <form
          style={formStyle}
          aria-label={t("editAction")}
          onSubmit={(e) => {
            e.preventDefault();
            if (patchEmpty) return;
            void run(`action:update:${item.id}`, t("actionUpdated"), () => updateActionItem(item.id, item.version, patch));
          }}
        >
          <div style={{ flex: "2 1 280px" }}>
            <label htmlFor="mtg-edit-desc" style={labelStyle}>{t("actionDescription")}</label>
            <input id="mtg-edit-desc" style={fieldStyle} maxLength={20000} value={eDesc} onChange={(e) => setEDesc(e.target.value)} />
          </div>
          <div style={{ flex: "1 1 190px" }}>
            <label htmlFor="mtg-edit-deadline" style={labelStyle}>{t("colDeadline")}</label>
            <input id="mtg-edit-deadline" type="datetime-local" style={fieldStyle} value={eDeadline} onChange={(e) => setEDeadline(e.target.value)} />
          </div>
          <div style={{ flex: "0 1 130px" }}>
            <label htmlFor="mtg-edit-priority" style={labelStyle}>{t("colPriority")}</label>
            <select id="mtg-edit-priority" style={fieldStyle} value={ePriority} onChange={(e) => setEPriority(e.target.value as ActionPriority)}>
              {ACTION_PRIORITIES.map((p) => (
                <option key={p} value={p}>{label("priority", p)}</option>
              ))}
            </select>
          </div>
          {directoryOk && (
            <div style={{ flex: "1 1 240px" }}>
              <div style={labelStyle}>{t("reassign")}</div>
              <EmployeePicker
                value={eAssignee}
                onChange={(id) => setEAssignee(id)}
                aria-label={t("reassign")}
                directory={permissions.employeeDirectory ?? "hrms"}
              />
            </div>
          )}
          <button type="submit" className="btn" disabled={busy !== null || patchEmpty}>
            {busy === `action:update:${item.id}` ? "…" : t("saveChanges")}
          </button>
        </form>
      )}
    </section>
  );
}
