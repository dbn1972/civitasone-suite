import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getTenantAuditLog } from "../../../_data/loaders";

export default async function TenantAuditPage() {
  const { data: events, source } = await getTenantAuditLog();

  const today = new Date().toISOString().slice(0, 10);

  const total = events.length;
  const successes = events.filter((e) => e.outcome === "success").length;
  const failures = events.filter((e) => e.outcome === "failure").length;
  const today24h = events.filter((e) => e.timestamp.slice(0, 10) === today).length;

  return (
    <div className="wrap">
      <PageHeader
        back="/tenant-admin"
        title="Audit Log"
        subtitle="Tenant-scoped audit events — all actor actions and outcomes."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn ghost">Filter</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📋" iconBg="#f1f5f9" label="Events (24h)" value={today24h} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Success" value={successes} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Failures" value={failures} />
        <StatCard icon="👥" iconBg="#eff6ff" label="Total Events" value={total} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h">
          <h3>Activity log</h3>
          <div className="seg"><span className="on">All</span><span>Failures</span></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td style={{ whiteSpace: "nowrap" }}>{event.timestamp.slice(0, 16).replace("T", " ")}</td>
                <td>
                  <div className="who">
                    <div className="av">{event.actor.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div className="nm">{event.actor}</div>
                      {event.ipAddress && <div className="ml"><span className="mono">{event.ipAddress}</span></div>}
                    </div>
                  </div>
                </td>
                <td><span className="mono">{event.action}</span></td>
                <td>{event.resource ?? "—"}</td>
                <td>
                  {event.outcome === "success" ? <span className="pill good">Success</span>
                    : event.outcome === "failure" ? <span className="pill bad">Failure</span>
                    : <span className="pill info">{event.outcome}</span>}
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td colSpan={5}><div className="empty-state"><div>📋</div><h4>No audit events yet</h4><p>Tenant-scoped activity will appear here as actions are performed.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
