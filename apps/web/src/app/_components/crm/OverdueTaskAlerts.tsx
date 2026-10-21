"use client";
/**
 * OverdueTaskAlerts — AC-005 (alerts). Lists the open tasks that are already
 * overdue, worst-aged first, so a manager can act before escalation fires. The
 * overdue count is gated on source==="error" → "—" + saved-info badge, never a
 * fabricated zero. Ageing is shown in plain words (e.g. "2d 3h").
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { DataSourceBadge } from "../DataSourceBadge";
import { StatGrid, StatCard, EmptyState, DataTable, Modal, Button } from "../ds";
import { DirectoryUserSelect } from "./DirectoryUserSelect";
import {
  getOverdueTaskPage, snoozeTask, reassignTask, getEscalationUsers, formatAgeing, OVERDUE_PAGE_SIZE,
  type OverdueTask, type AaSource, type EscalationUser,
} from "@/lib/crm/activityAccount";
import { todayIST, addDaysIST, formatIndianDateTime } from "@/lib/formatters";

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatIndianDateTime(iso);
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
  task, users, usersTruncated, usersUnavailable, onDone,
}: { task: OverdueTask; users: EscalationUser[]; usersTruncated: boolean; usersUnavailable: boolean; onDone: () => void }) {
  const t = useTranslations("crmOverdueTaskAlerts");
  const formError = useFormError("task");
  const ownerFieldId = useId();
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
        title={choices.length === 0 ? (usersUnavailable ? t("usersUnavailable") : t("noUsersToReassign")) : undefined}
        onClick={() => { setError(undefined); setOwnerId(""); setReason(""); setOpen(true); }}
      >
        {t("reassign")}
      </button>
      <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} closeOnOverlayClick={!busy} size="sm" title={t("reassignTitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            {t.rich("reassignIntro", { subject: task.subject || t("thisTask"), strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            <label htmlFor={ownerFieldId}>{t("newOwner")}</label>
            {/* A truncated directory adds a server-side name search, so nobody is unreachable. */}
            <DirectoryUserSelect
              id={ownerFieldId}
              value={ownerId}
              onChange={setOwnerId}
              users={users}
              truncated={usersTruncated}
              excludeId={task.ownerId ?? null}
              leading={<option value="">{t("selectUser")}</option>}
              style={{ padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" }}
            />
          </div>
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
  // GAP-CRM-TASK-ESCALATION-02: server-side paging. `total` is the REAL number of overdue
  // tasks (meta.total); `page` is the 0-based page the reader is on.
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [source, setSource] = useState<AaSource | "loading">("loading");
  // GAP-CRM-TASK-ESCALATION-06: bump to re-run the fetch after a snooze so the
  // snoozed (no-longer-overdue) task drops off the list.
  const [reload, setReload] = useState(0);
  // GAP-CRM-TASK-ESCALATION-06: the identity directory, for owner names and
  // the Reassign picker. A failed load just leaves names unresolved.
  const [users, setUsers] = useState<EscalationUser[]>([]);
  const [usersUnavailable, setUsersUnavailable] = useState(false);
  // True = the loaded list is not the whole directory (large tenant): the Reassign picker then offers a name search.
  const [usersTruncated, setUsersTruncated] = useState(false);
  useEffect(() => {
    let live = true;
    void getEscalationUsers().then(({ data, source: s, truncated }) => {
      if (!live) return;
      setUsers(data);
      setUsersTruncated(truncated === true);
      setUsersUnavailable(s === "error");
    });
    return () => { live = false; };
  }, []);
  const names = new Map(users.map((u) => [u.id, u.name] as const));

  useEffect(() => {
    let live = true;
    setSource("loading");
    void getOverdueTaskPage({ limit: OVERDUE_PAGE_SIZE, offset: page * OVERDUE_PAGE_SIZE }).then(({ data, source: s }) => {
      if (!live) return;
      // The last task on the last page was just snoozed/reassigned: step back to the new last page
      // rather than showing an empty page of a non-empty list.
      if (s === "api" && data.tasks.length === 0 && data.total > 0 && page > 0) {
        setPage(Math.max(0, Math.ceil(data.total / OVERDUE_PAGE_SIZE) - 1));
        return;
      }
      setTasks(data.tasks);
      setTotal(data.total);
      setSource(s);
    });
    return () => {
      live = false;
    };
  }, [reload, page]);

  const isError = source === "error";
  const pageCount = Math.max(1, Math.ceil(total / OVERDUE_PAGE_SIZE));
  const firstShown = total === 0 ? 0 : page * OVERDUE_PAGE_SIZE + 1;
  const lastShown = page * OVERDUE_PAGE_SIZE + tasks.length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <StatGrid>
        <StatCard
          icon="🔴"
          iconBg="var(--badbg)"
          label={t("statLabel")}
          value={source === "loading" ? "…" : isError ? "—" : total.toLocaleString("en-IN")}
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
          <>
          {/* GAP-CRM-TASK-ESCALATION-02: the server pages (50 per page) and reports the real
              total, so a large backlog is fully reachable and the count is honest. */}
          <DataTable<OverdueTask & Record<string, unknown>>
            rows={tasks as Array<OverdueTask & Record<string, unknown>>}
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
                    <ReassignControl task={row} users={users} usersTruncated={usersTruncated} usersUnavailable={usersUnavailable} onDone={() => setReload((n) => n + 1)} />
                    <SnoozeControl task={row} onSnoozed={() => setReload((n) => n + 1)} />
                  </div>
                ),
              },
            ]}
            emptyIcon="✅"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
          <nav
            aria-label={t("pagerAria")}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "10px 12px" }}
          >
            <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              {t("showing", {
                from: firstShown.toLocaleString("en-IN"),
                to: lastShown.toLocaleString("en-IN"),
                total: total.toLocaleString("en-IN"),
              })}
            </p>
            {pageCount > 1 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button type="button" variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  {t("previousPage")}
                </Button>
                <span style={{ fontSize: 13 }}>{t("pageOf", { page: page + 1, pages: pageCount })}</span>
                <Button type="button" variant="ghost" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
                  {t("nextPage")}
                </Button>
              </div>
            ) : null}
          </nav>
          </>
        )}
      </div>
    </div>
  );
}
