import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getBreakglassLog } from "../../../_data/loaders";

export default async function BreakglassPage() {
  const { data: events, source } = await getBreakglassLog();

  const total = events.length;
  const activeNow = events.filter((e) => e.status === "active").length;
  const ended = events.filter((e) => e.status === "ended").length;
  const thisMonth = events.filter((e) => {
    const d = new Date(e.startedAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  return (
    <div className="wrap">
      {activeNow > 0 && (
        <div className="banner" style={{ background: "#fef3f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>
          🚨 <b>{activeNow} active break-glass session{activeNow > 1 ? "s" : ""} in progress.</b> SRE has been alerted.
        </div>
      )}
      <PageHeader
        back="/tenant-admin"
        title="Break-Glass Access Log"
        subtitle="Emergency support access events — all instances require justification and are fully audited."
        actions={
          <>
            <button className="btn ghost">Export log</button>
            {source === "error" && <DataSourceBadge source={source} />}
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Active Now" value={activeNow} />
        <StatCard icon="📅" iconBg="#fffaeb" label="This Month" value={thisMonth} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Ended" value={ended} />
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Events" value={total} />
      </div>
      <div className="card">
        <div className="card-h">
          <h3>Break-glass log</h3>
          <div className="seg"><span className="on">All</span><span>Active</span></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Requester</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Duration</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>
                  <div className="who">
                    <div className="av">{event.actor.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div className="nm">{event.actor}</div>
                      <div className="ml">{event.actorEmail}</div>
                    </div>
                  </div>
                </td>
                <td style={{ maxWidth: 200 }}>{event.reason}</td>
                <td>{event.startedAt.slice(0, 16).replace("T", " ")}</td>
                <td>{event.endedAt ? "Ended" : "Ongoing"}</td>
                <td>
                  {event.status === "active" ? <span className="pill bad">Active</span>
                    : event.status === "ended" ? <span className="pill good">Ended</span>
                    : <span className="pill mut">{event.status.replace(/_/g, " ")}</span>}
                </td>
                <td>
                  {event.status === "active" && (
                    <span style={{ fontSize: 12, color: "#ef4444", cursor: "not-allowed" }}>Revoke</span>
                  )}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td colSpan={6}><div className="empty-state"><div>🔑</div><h4>No break-glass events</h4><p>Emergency support access events will appear here if invoked.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
