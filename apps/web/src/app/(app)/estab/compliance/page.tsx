import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabCompliance } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";

export default async function CompliancePage() {
  const { data: items, source } = await getEstabCompliance();
  const today = new Date().toISOString().split("T")[0];
  const complianceRate = items.length > 0
    ? Math.round((items.filter((c) => c.status === "complied").length / items.length) * 100)
    : 0;
  const openActions = items.filter((c) => c.status === "pending").length;
  const overdue = items.filter((c) => c.status === "overdue").length;
  const escalated = items.filter((c) => c.status === "overdue" && c.dueDate < today).length;

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Action / Decision Compliance"
        subtitle="Track closure of meeting action items & decisions."
        actions={<button className="btn primary">Reminders</button>}
      />
      <StatGrid>
        <StatCard icon="✅" iconBg="#ecfdf3" label="Compliance Rate" value={`${complianceRate}%`} delta="+3%" up />
        <StatCard icon="📋" iconBg="#e6f7f5" label="Open Actions" value={openActions.toLocaleString("en-IN")} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Overdue" value={overdue.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Escalated" value={escalated.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Action items across meetings</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Overdue</span>
          </div>
        </div>
        {items.length === 0 ? (
          <EmptyState icon="✅" title="No compliance items" message="Action items from meetings will appear here." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Action</th>
                <th>Category</th>
                <th>Assigned to</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td>{c.category}</td>
                  <td>{c.assignedTo ?? "—"}</td>
                  <td>{c.dueDate}</td>
                  <td>
                    <StatusPill status={c.status.replace(/_/g, " ")} label={c.status.replace(/_/g, " ")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
