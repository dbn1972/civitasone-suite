import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";
import { getCRMActivities } from "../../../_data/loaders";

export default async function Page() {
  const { data: activities, source } = await getCRMActivities();

  const dueToday = activities.filter((a) => a.dueDate === new Date().toISOString().slice(0, 10)).length;
  const overdue = activities.filter((a) => a.status === "overdue").length;
  const completed = activities.filter((a) => a.status === "completed").length;

  return (
    <>
      <PageHeader
        title="CRM Activities"
        subtitle="Calls, meetings, emails, tasks and notes."
        back="/crm"
        actions={
          <button className="btn primary">+ Log Activity</button>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="⚡" iconBg="#fce7ee" label="Total" value={activities.length.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#fce7ee" label="Due Today" value={dueToday.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef2f2" label="Overdue" value={overdue.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Completed" value={completed.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Activities</h3>
          <div className="seg"><span className="on">All</span><span>Mine</span><span>Today</span></div>
        </div>
        {activities.length === 0 ? (
          <EmptyState icon="⚡" title="No activities yet" message="Schedule your first call, meeting, or task." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Type</th>
                <th>Subject</th>
                <th>Related To</th>
                <th>Due Date</th>
                <th>Owner</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id}>
                  <td><StatusPill status={a.type} label={a.type} /></td>
                  <td>{a.subject}</td>
                  <td>{a.relatedTo ?? "—"}</td>
                  <td>{a.dueDate ?? "—"}</td>
                  <td>{a.owner}</td>
                  <td><StatusPill status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
