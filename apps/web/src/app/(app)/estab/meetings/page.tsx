import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMeetings } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";

export default async function MeetingsPage() {
  const { data: meetings, source } = await getMeetings();
  const today = new Date().toISOString().split("T")[0];
  const upcoming = meetings.filter((m) => m.status === "scheduled" && m.scheduledDate >= today).length;
  const completed = meetings.filter((m) => m.status === "completed").length;
  const momPending = meetings.filter((m) => m.status === "in_progress").length;
  const totalActions = meetings.length;

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Meeting Management"
        subtitle="Schedule meetings, prepare agenda, capture MOM & track actions."
        actions={
          <>
            <button className="btn ghost">Calendar</button>
            <button className="btn primary">+ Schedule</button>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📅" iconBg="#e6f7f5" label="Meetings (wk)" value={upcoming.toLocaleString("en-IN")} />
        <StatCard icon="📝" iconBg="#fffaeb" label="MOM Pending" value={momPending.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#eff6ff" label="Action Items" value={totalActions.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Compliance" value={completed > 0 ? `${Math.round((completed / meetings.length) * 100)}%` : "—"} delta="+3%" up />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Meetings</h3>
          <div className="seg">
            <span className="on">Upcoming</span>
            <span>Past</span>
          </div>
        </div>
        {meetings.length === 0 ? (
          <EmptyState icon="📅" title="No meetings found" message="Schedule a meeting to get started." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>When</th>
                <th>Venue</th>
                <th className="num">Attendees</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id} className="clickable">
                  <td>
                    <a href={`/estab/meetings/${m.id}`}>{m.title}</a>
                  </td>
                  <td>{m.scheduledDate}{m.scheduledTime ? ` · ${m.scheduledTime}` : ""}</td>
                  <td>{m.venue ?? "—"}</td>
                  <td className="num">{m.attendeesCount}</td>
                  <td>
                    <StatusPill status={m.status.replace(/_/g, " ")} label={m.status.replace(/_/g, " ")} />
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
