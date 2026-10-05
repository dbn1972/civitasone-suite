"use client";
/**
 * OverdueTaskAlerts — AC-005 (alerts). Lists the open tasks that are already
 * overdue, worst-aged first, so a manager can act before escalation fires. The
 * overdue count is gated on source==="error" → "—" + saved-info badge, never a
 * fabricated zero. Ageing is shown in plain words (e.g. "2d 3h").
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DataSourceBadge } from "../DataSourceBadge";
import { StatGrid, StatCard, EmptyState, DataTable } from "../ds";
import { getOverdueTasks, formatAgeing, type OverdueTask, type AaSource } from "@/lib/crm/activityAccount";

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
function ownerLabel(task: OverdueTask, t: ReturnType<typeof useTranslations>): string {
  if (task.owner) return task.owner;
  if (task.ownerId) return t("ownerUnavailable");
  return "—";
}

export function OverdueTaskAlerts() {
  const t = useTranslations("crmOverdueTaskAlerts");
  const [tasks, setTasks] = useState<OverdueTask[]>([]);
  const [source, setSource] = useState<AaSource | "loading">("loading");

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
  }, []);

  const isError = source === "error";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <StatGrid>
        <StatCard
          icon="🔴"
          iconBg="#fef2f2"
          label="Overdue tasks"
          value={source === "loading" ? "…" : isError ? "—" : tasks.length.toLocaleString("en-IN")}
        />
      </StatGrid>

      <div className="card">
        <div className="card-h">
          <h3>Overdue open tasks</h3>
          {isError ? <DataSourceBadge source="error" /> : null}
        </div>
        {source === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>Loading overdue tasks…</p>
        ) : isError ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
            — Overdue tasks unavailable right now. <DataSourceBadge source="error" />
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
                render: (task) => {
                  const href = task.subjectType && task.subjectId ? subjectHref(task.subjectType, task.subjectId) : null;
                  return href ? <a href={href}>{task.subject || t("taskFallback")}</a> : (task.subject || t("taskFallback"));
                },
              },
              { key: "dueAt", label: t("colDue"), render: (task) => fmtDateTime(task.dueAt) },
              {
                key: "ageMinutes",
                label: t("colOverdueBy"),
                render: (task) => (
                  <span className="pill" style={{ background: "#fef2f2", color: "#b42318" }}>{formatAgeing(task.ageMinutes)}</span>
                ),
              },
              { key: "owner", label: t("colOwner"), render: (task) => ownerLabel(task, t) },
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
