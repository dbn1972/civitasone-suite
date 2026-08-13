import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getProjectTasks } from "../../../../_data/loaders";
import { PageHeader, Card, EmptyState, StatGrid, StatCard } from "@/app/_components/ds";

export default async function ProjectTasksPage({ params }: { params: { id: string } }) {
  const { data: tasks, source } = await getProjectTasks(params.id);

  const pending   = tasks.filter((t) => t.status === "pending").length;
  const inProg    = tasks.filter((t) => t.status === "in_progress").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const blocked   = tasks.filter((t) => t.status === "blocked").length;

  function statusColor(status: string): string {
    if (status === "completed") return "var(--good)";
    if (status === "blocked")   return "var(--bad)";
    if (status === "in_progress") return "var(--warn)";
    return "var(--ink2)";
  }

  function statusBg(status: string): string {
    if (status === "completed")  return "rgba(5,150,105,0.12)";
    if (status === "blocked")    return "rgba(220,38,38,0.12)";
    if (status === "in_progress") return "rgba(245,158,11,0.12)";
    return "rgba(100,116,139,0.10)";
  }

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Work breakdown and task tracking for this project."
        back={`/projects/${params.id}`}
        actions={
          <Link href={`/projects/${params.id}`} className="btn">
            Back to Project
          </Link>
        }
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef0fe" label="Pending"     value={pending} />
        <StatCard icon="⚙️" iconBg="#fffaeb" label="In Progress" value={inProg} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed"   value={completed} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Blocked"     value={blocked} />
      </StatGrid>
      <Card title="Tasks">
        {tasks.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No tasks"
            message="No tasks have been defined for this project. Use the API to create tasks."
          />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {["Task", "Status", "Progress", "Planned Start", "Planned End", "Weight %"].map((c) => (
                    <th key={c} scope="col">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: t.parentTaskId ? 400 : 600, paddingLeft: t.parentTaskId ? 16 : 0 }}>
                        {t.name}
                      </div>
                      {t.description && (
                        <div style={{ fontSize: "0.8rem", color: "var(--ink2)", marginTop: 2 }}>
                          {t.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: "var(--r)",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          background: statusBg(t.status),
                          color: statusColor(t.status),
                        }}
                      >
                        {t.status.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 80,
                            height: 6,
                            background: "var(--line)",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${t.progressPct}%`,
                              height: "100%",
                              background: t.progressPct >= 100 ? "var(--good)" : "var(--warn)",
                            }}
                          />
                        </div>
                        <span style={{ fontSize: "0.82rem", color: "var(--ink2)" }}>
                          {t.progressPct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {t.plannedStart ?? "—"}
                    </td>
                    <td style={{ color: "var(--ink2)", fontSize: "0.88rem" }}>
                      {t.plannedEnd ?? "—"}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--ink2)", fontSize: "0.88rem" }}>
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
