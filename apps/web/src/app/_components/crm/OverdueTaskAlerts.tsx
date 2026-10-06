"use client";
/**
 * OverdueTaskAlerts — AC-005 (alerts). Lists the open tasks that are already
 * overdue, worst-aged first, so a manager can act before escalation fires. The
 * overdue count is gated on source==="error" → "—" + saved-info badge, never a
 * fabricated zero. Ageing is shown in plain words (e.g. "2d 3h").
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { DataSourceBadge } from "../DataSourceBadge";
import { StatGrid, StatCard, EmptyState, DataTable, Modal, Button } from "../ds";
import {
  getOverdueTasks, snoozeTask, reassignTask, getEscalationUsers, formatAgeing,
  type OverdueTask, type AaSource, type EscalationUser,
} from "@/lib/crm/activityAccount";
import { todayIST, addDaysIST } from "@/lib/formatters";

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Keep path prefixes as plain string literals so crm-link-integrity can resolve
 * them. Returns null when no detail route exists for the subject type (e.g.
 * 'lead' has no /crm/leads/[id] page) so the caller renders plain text instead
 * of a wrong link (GAP-CRM-TASK-ESCALATION-04).
 */
export function subjectHref(subjectType: string, subjectId: string): string | null {
  if (!subjectId) return null;
  switch (subjectType) {
    case "account":
      return `/crm/accounts/${subjectId}`;
    case "contact":
      return `/crm/contacts/${subjectId}`;
    case "deal":
      return `/crm/deals/${subjectId}`;
    // 'lead' and any unknown type have no detail route — render plain text.
    default:
      return null;
  }
}

/**
 * GAP-CRM-TASK-ESCALATION-02 (IDLEAK): the Owner cell must never print a raw
 * owner id. Show the display name when known; when only an id exists, say so
 * plainly rather than leaking the UUID.
 */
function ownerLabel(t: OverdueTask, names: ReadonlyMap<string, string>, unavailable: string): string {
  if (t.owner) return t.owner;
  if (t.ownerId) return names.get(t.ownerId) ?? unavailable;
  return "—";
}

/** GAP-CRM-TASK-ESCALATION-06: a snooze/reassign must say why (audited). */
const MIN_REASON = 10;

function ReasonField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const t = useTranslations("crmOverdueTaskAlerts");
  const short = value.trim().length > 0 && value.trim().length < MIN_REASON;
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
      <span>{t("reasonLabel")}</span>
      <textarea
        id={id}
        value={value}
        rows={2}
        maxLength={500}
        aria-invalid={short || undefined}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)" }}
      />
      {short ? <span style={{ fontSize: 12, color: "var(--bad)" }}>{t("reasonShort", { min: MIN_REASON })}</span> : null}
    </label>
  );
}

/**
 * GAP-CRM-TASK-ESCALATION-06: reassign an overdue task to another user, with
 * a required reason. Users come from the identity directory (the same list the
 * task-escalation editor uses). The server records owner + reason on the audit
 * event and stays the authority on role/tenant.
 */
function ReassignControl({
  task, users, onDone,
}: { task: OverdueTask; users: EscalationUser[]; onDone: () => void }) {
  const t = useTranslations("crmOverdueTaskAlerts");
  const formError = useFormError("task");
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const choices = users.filter((u) => u.id !== task.ownerId);
  const canSave = !!ownerId && reason.trim().length >= MIN_REASON && !busy;

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await reassignTask(task.id, ownerId, reason.trim());
      setOpen(false);
      onDone();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        style={{ fontSize: 13 }}
        disabled={choices.length === 0}
        title={choices.length === 0 ? t("noUsersToReassign") : undefined}
        onClick={() => { setError(undefined); setOwnerId(""); setReason(""); setOpen(true); }}
      >
        {t("reassign")}
      </button>
      <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} closeOnOverlayClick={!busy} size="sm" title={t("reassignTitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            {t.rich("reassignIntro", { subject: task.subject || t("thisTask"), strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <span>{t("newOwner")}</span>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              style={{ padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
            >
              <option value="">{t("selectUser")}</option>
              {choices.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <ReasonField id={`reassign-reason-${task.id}`} value={reason} onChange={setReason} />
          {error ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>{error}</p> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("cancel")}</Button>
            <Button type="button" onClick={() => void submit()} disabled={!canSave} loading={busy}>
              {busy ? t("reassigning") : t("reassign")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * GAP-CRM-TASK-ESCALATION-06: snooze an overdue task to a new due date. Opens
 * the shared ds Modal with a date input (defaulting to tomorrow, min today),
 * PATCHes the activity's dueDate via snoozeTask (CQRS 202 → the crm-service
 * applies it and emits the audit event inside the transaction), then asks the
 * parent to refresh the list. The server remains the authority on role/tenant.
 */
function SnoozeControl({ task, onSnoozed }: { task: OverdueTask; onSnoozed: () => void }) {
  const t = useTranslations("crmOverdueTaskAlerts");
  const formError = useFormError("task");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => addDaysIST(todayIST(), 1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await snoozeTask(task.id, date, reason.trim());
      setOpen(false);
      onSnoozed();
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn" style={{ fontSize: 13 }} onClick={() => { setError(undefined); setReason(""); setOpen(true); }}>
        {t("snooze")}
      </button>
      <Modal
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        closeOnOverlayClick={!busy}
        size="sm"
        title={t("snoozeTitle")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            {t.rich("snoozeIntro", { subject: task.subject || t("thisTask"), strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <span>{t("newDueDate")}</span>
            <input
              type="date"
              value={date}
              min={todayIST()}
              onChange={(e) => setDate(e.target.value)}
              style={{ padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
            />
          </label>
          <ReasonField id={`snooze-reason-${task.id}`} value={reason} onChange={setReason} />
          {error ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>{error}</p> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("cancel")}</Button>
            <Button type="button" onClick={() => void submit()} disabled={busy || !date || reason.trim().length < MIN_REASON} loading={busy}>
              {busy ? t("snoozing") : t("snooze")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function OverdueTaskAlerts() {
  const t = useTranslations("crmOverdueTaskAlerts");
  const [tasks, setTasks] = useState<OverdueTask[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  // GAP-CRM-TASK-ESCALATION-06: bump to re-run the fetch after a snooze so the
  // snoozed (no-longer-overdue) task drops off the list.
  const [reload, setReload] = useState(0);
  // GAP-CRM-TASK-ESCALATION-06: the identity directory, for owner names and
  // the Reassign picker. A failed load just leaves names unresolved.
  const [users, setUsers] = useState<EscalationUser[]>([]);
  useEffect(() => {
    let live = true;
    void getEscalationUsers().then(({ data }) => { if (live) setUsers(data); });
    return () => { live = false; };
  }, []);
  const names = new Map(users.map((u) => [u.id, u.name] as const));

  useEffect(() => {
    let live = true;
    setSource("loading");
    void getOverdueTasks().then(({ data, source: s }) => {
      if (!live) return;
      setTasks(data);
      setSource(s);
    });
    return () => {
      live = false;
    };
  }, [reload]);

  const isError = source === "error";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <StatGrid>
        <StatCard
          icon="🔴"
          iconBg="var(--badbg)"
          label={t("statLabel")}
          value={source === "loading" ? "…" : isError ? "—" : tasks.length.toLocaleString("en-IN")}
        />
      </StatGrid>

      <div className="card">
        <div className="card-h">
          <h3>{t("tableHeading")}</h3>
          {isError ? <DataSourceBadge source="error" /> : null}
        </div>
        {source === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>{t("loading")}</p>
        ) : isError ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
            {t("unavailable")} <DataSourceBadge source="error" />
          </p>
        ) : tasks.length === 0 ? (
          <EmptyState icon="✅" title={t("emptyTitle")} message={t("emptyMessage")} />
        ) : (
          // GAP-CRM-TASK-ESCALATION-02: paginate (50/page) so a large overdue
          // backlog can't render an unbounded table; Owner is masked, never a raw id.
          <DataTable<OverdueTask & Record<string, unknown>>
            rows={tasks as Array<OverdueTask & Record<string, unknown>>}
            pageSize={50}
            columns={[
              {
                key: "subject",
                label: t("colTask"),
                render: (row) => {
                  const href = row.subjectType && row.subjectId ? subjectHref(row.subjectType, row.subjectId) : null;
                  return href ? <a href={href}>{row.subject || t("taskFallback")}</a> : (row.subject || t("taskFallback"));
                },
              },
              { key: "dueAt", label: t("colDue"), render: (row) => fmtDateTime(row.dueAt) },
              {
                key: "ageMinutes",
                label: t("colOverdueBy"),
                render: (row) => (
                  <span className="pill bad">{formatAgeing(row.ageMinutes)}</span>
                ),
              },
              { key: "owner", label: t("colOwner"), render: (row) => ownerLabel(row, names, t("ownerUnavailable")) },
              {
                // GAP-CRM-TASK-ESCALATION-06: row actions — Reassign (new owner,
                // crm.activities.owner_id from 0107) and Snooze (push the due
                // date out). Both need a reason, recorded on the audit event.
                key: "actions",
                label: "",
                render: (row) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <ReassignControl task={row} users={users} onDone={() => setReload((n) => n + 1)} />
                    <SnoozeControl task={row} onSnoozed={() => setReload((n) => n + 1)} />
                  </div>
                ),
              },
            ]}
            emptyIcon="✅"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </div>
    </div>
  );
}
