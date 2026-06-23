import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { getTicketAnalytics } from "../../../_data/loaders";

export default async function Page() {
  const { data: analytics, source } = await getTicketAnalytics();

  return (
    <>
      <PageHeader
        title="Helpdesk Reports"
        subtitle="Service performance and support quality indicators."
        back="/helpdesk"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎫" iconBg="#fff3e0" label="Total Tickets" value={analytics.totalTickets.toLocaleString("en-IN")} />
        <StatCard icon="🔵" iconBg="#eff6ff" label="Open" value={analytics.openTickets.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Resolved (MTD)" value={analytics.resolvedThisMonth.toLocaleString("en-IN")} />
        <StatCard icon="🚨" iconBg="#fef2f2" label="SLA Breached" value={analytics.slaBreachedCount.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="grid g-2">
        <div className="card">
          <div className="card-h"><h3>By Priority</h3></div>
          {analytics.byPriority.length === 0 ? (
            <EmptyState icon="📊" title="No data" message="Priority breakdown will appear here." />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th style={{ textAlign: "right" }}>Count</th>
                  <th>% of Total</th>
                </tr>
              </thead>
              <tbody>
                {analytics.byPriority.map((row) => (
                  <tr key={row.priority}>
                    <td style={{ textTransform: "capitalize" }}>{row.priority}</td>
                    <td className="num">{row.count.toLocaleString("en-IN")}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="bar" style={{ width: 80 }}>
                          <div className="fill" style={{ width: `${Math.min(row.pct, 100)}%` }} />
                        </div>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{row.pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-h"><h3>By Channel</h3></div>
          {analytics.byChannel.length === 0 ? (
            <EmptyState icon="📊" title="No data" message="Channel breakdown will appear here." />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th style={{ textAlign: "right" }}>Count</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {analytics.byChannel.map((row) => (
                  <tr key={row.channel}>
                    <td style={{ textTransform: "capitalize" }}>{row.channel.replace(/_/g, " ")}</td>
                    <td className="num">{row.count.toLocaleString("en-IN")}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="bar" style={{ width: 80 }}>
                          <div className="fill" style={{ width: `${Math.min(row.pct, 100)}%`, background: "#fb923c" }} />
                        </div>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{row.pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h3>Performance</h3></div>
        <div className="fields">
          <div className="fld"><div className="fl">Avg Resolution Time</div><div className="fv">{analytics.avgResolutionHours.toFixed(1)} hrs</div></div>
        </div>
      </div>
    </>
  );
}
