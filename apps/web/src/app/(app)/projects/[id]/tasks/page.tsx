import { getProjectTasks } from "../../../../_data/loaders";
import { PageHeader, Card, EmptyState, StatGrid, StatCard, RefreshErrorState, ProgressBar, StatusPill } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, PROJECT_WRITE_ROLES } from "@/lib/auth/roleGuard";
import { orderTaskTree } from "./taskTree";
import { AddTaskForm } from "./AddTaskForm";

export default async function ProjectTasksPage({ params }: { params: { id: string } }) {
  const { data: tasks, source } = await getProjectTasks(params.id);
  const errored = source === "error";

  // GAP-PROJECTS-DETAIL-TASKS-01: only project managers/officers (project-service
  // PROJ_ROLES) may add tasks; the server 403s others. The service is the gate.
  const canManage = hasAnyRole(getSessionRoles(), PROJECT_WRITE_ROLES);

  const pending   = errored ? 0 : tasks.filter((t) => t.status === "pending").length;
  const inProg    = errored ? 0 : tasks.filter((t) => t.status === "in_progress").length;
  const completed = errored ? 0 : tasks.filter((t) => t.status === "completed").length;
  const blocked   = errored ? 0 : tasks.filter((t) => t.status === "blocked").length;

  // GAP-PROJECTS-DETAIL-TASKS-02: group sub-tasks under their parent (depth-first),
  // indenting by depth*16 so any level of nesting reads as a tree.
  const orderedTasks = errored ? [] : orderTaskTree(tasks);

  // GAP-PROJECTS-DETAIL-TASKS-05: a blocked task must read as blocked (bad), a
  // completed one as done (good); anything in flight uses the brand colour. The
  // bar width itself is clamped to 0–100 by ProgressBar.
  function progressColor(status: string): string {
    if (status === "blocked") return "var(--bad)";
    if (status === "completed") return "var(--good)";
    return "var(--brand)";
  }

  return (
    <>
      {/* GAP-PROJECTS-DETAIL-TASKS-03: the PageHeader already renders a back link
          via `back`; the duplicate "Back to Project" action was removed. */}
      <PageHeader
        title="Tasks"
        subtitle="Work breakdown and task tracking for this project."
        back={`/projects/${params.id}`}
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Pending"     value={errored ? "—" : pending} />
        <StatCard icon="⚙️" iconBg="#fffaeb" label="In Progress" value={errored ? "—" : inProg} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed"   value={errored ? "—" : completed} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Blocked"     value={errored ? "—" : blocked} />
      </StatGrid>
      {canManage && !errored && (
        <Card title="Add Task" padding>
          <AddTaskForm projectId={params.id} />
        </Card>
      )}
      <Card title="Tasks">
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "project tasks" })} backHref={`/projects/${params.id}`} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No tasks yet"
            message={canManage ? "Add the first task to start building the work breakdown." : "No tasks have been defined for this project yet."}
          />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {["Task", "Status", "Progress", "Planned Start", "Planned End", "Actual Start", "Actual End", "Weight %"].map((c) => (
                    <th key={c} scope="col">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderedTasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: t.depth > 0 ? 400 : 600, paddingInlineStart: t.depth * 16 }}>
                        {t.name}
                      </div>
                      {t.description && (
                        <div style={{ fontSize: "0.8rem", color: "var(--ink2)", marginTop: 2, paddingInlineStart: t.depth * 16 }}>
                          {t.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusPill status={t.status} />
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 80 }}>
                          <ProgressBar value={t.progressPct} color={progressColor(t.status)} />
                        </div>
                        <span style={{ fontSize: "0.82rem", color: "var(--ink2)" }}>
                          {Math.min(100, Math.max(0, Math.round(t.progressPct)))}%
                        </span>
                      </div>
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {formatIndianDate(t.plannedStart)}
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {formatIndianDate(t.plannedEnd)}
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {formatIndianDate(t.actualStart)}
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {formatIndianDate(t.actualEnd)}
                    </td>
                    <td style={{ textAlign: "end", color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {t.weightPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
