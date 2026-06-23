import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatusPill } from "../../../_components/ds";
import { getAuditPlan } from "../../../_data/loaders";

function riskLevel(type: string) {
  if (type === "special" || type === "compliance") return "High";
  if (type === "performance") return "Medium";
  return "Low";
}

export default async function AuditPlanPage() {
  const { data: items, source } = await getAuditPlan();

  const total = items.length;
  const completed = items.filter((i) => i.status === "completed").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const riskBased = total > 0 ? Math.round(((total - items.filter((i) => i.type === "routine").length) / total) * 100) : 0;

  return (
    <div className="wrap">
      <PageHeader
        title="Internal Audit Planning"
        subtitle="Risk-based annual audit plan & universe."
        actions={
          <>
            <button className="btn ghost">Audit universe</button>
            <button className="btn primary">+ Plan Audit</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🗓️" iconBg="#fef2f2" label="Planned Audits" value={total} delta="FY26" />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={inProgress} />
        <StatCard icon="🎯" iconBg="#eff6ff" label="Risk-based" value={`${riskBased}%`} delta="coverage" up />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h">
          <h3>Audit plan</h3>
          <div className="seg"><span className="on">FY26</span><span>FY25</span></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Audit area</th>
              <th>Period</th>
              <th>Risk</th>
              <th>Team</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.auditUnit}{item.department ? ` · ${item.department}` : ""}</td>
                <td>{item.plannedFrom} – {item.plannedTo}</td>
                <td>{riskLevel(item.type)}</td>
                <td>{item.auditorTeam ?? "—"}</td>
                <td>
                  {item.status === "in_progress" ? <span className="pill warn">In progress</span>
                    : item.status === "completed" ? <span className="pill good">Completed</span>
                    : item.status === "deferred" ? <span className="pill mut">Deferred</span>
                    : <span className="pill info">Planned</span>}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5}><div className="empty-state"><div>🗓️</div><h4>No plan items</h4><p>Scheduled audit engagements will appear here.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
