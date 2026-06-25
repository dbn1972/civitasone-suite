import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState } from "../../../_components/ds";
import { getTicketAnalytics } from "../../../_data/loaders";

type PriorityRow = {
  priority: string;
  count: number;
  pct: string;
};

type ChannelRow = {
  channel: string;
  count: number;
  pct: string;
};

export default async function Page() {
  const { data: analytics, source } = await getTicketAnalytics();

  const priorityRows: PriorityRow[] = analytics.byPriority.map((row) => ({
    priority: row.priority.charAt(0).toUpperCase() + row.priority.slice(1),
    count: row.count,
    pct: `${row.pct.toFixed(1)}%`,
  }));

  const channelRows: ChannelRow[] = analytics.byChannel.map((row) => ({
    channel: row.channel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    count: row.count,
    pct: `${row.pct.toFixed(1)}%`,
  }));

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
          {priorityRows.length === 0 ? (
            <EmptyState icon="📊" title="No data" message="Priority breakdown will appear here." />
          ) : (
            <DataTable<PriorityRow>
              columns={[
                { key: "priority", label: "Priority" },
                { key: "count", label: "Count", align: "right" },
                { key: "pct", label: "% of Total" },
              ]}
              rows={priorityRows}
              sortable
            />
          )}
        </div>
        <div className="card">
          <div className="card-h"><h3>By Channel</h3></div>
          {channelRows.length === 0 ? (
            <EmptyState icon="📊" title="No data" message="Channel breakdown will appear here." />
          ) : (
            <DataTable<ChannelRow>
              columns={[
                { key: "channel", label: "Channel" },
                { key: "count", label: "Count", align: "right" },
                { key: "pct", label: "%" },
              ]}
              rows={channelRows}
              sortable
            />
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
