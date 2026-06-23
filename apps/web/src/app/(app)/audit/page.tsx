import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, StatusPill } from "../../_components/ds";
import { getAuditItems } from "../../_data/loaders";

export default async function AuditPage() {
  const { data: auditItems, source } = await getAuditItems();

  const total = auditItems.length;
  const successes = auditItems.filter((i) => i.outcome === "success").length;
  const failures = auditItems.filter((i) => i.outcome === "failure").length;

  return (
    <div className="wrap">
      <PageHeader
        title="Audit Events"
        subtitle="Tenant-scoped activity log with outcome and resource context."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">Filter</button>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="#eef2ff" label="Total Events" value={total} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Success" value={successes} />
        <StatCard icon="🔐" iconBg="#fffaeb" label="Failures" value={failures} />
        <StatCard icon="🚨" iconBg="#fef3f2" label="Policy Alerts" value={failures > 0 ? failures : 0} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h"><h3>Audit event log</h3></div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {auditItems.map((item, i) => (
              <tr key={i}>
                <td>{item.actor}</td>
                <td><span className="mono">{item.action}</span></td>
                <td>{item.resource}</td>
                <td><StatusPill status={item.outcome} label={item.outcome} /></td>
              </tr>
            ))}
            {auditItems.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <div className="empty-state"><div>📜</div><h4>No audit events</h4><p>Activity will appear here as actions are performed.</p></div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
