import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getTicketAnalytics } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { formatDurationHours, humanizeStatus } from "@/lib/formatters";
import { ReportPeriodNav, PERIOD_LABELS, type ReportPeriod } from "./ReportPeriodNav";

type PriorityRow = {
  priority: string;
  // GAP-HELPDESK-REPORTS-05: keep pct as a NUMBER so DataTable sorts it
  // numerically and CSV/other consumers get a number, not a "14.3%" string.
  pct: number;
  count: number;
};

type ChannelRow = {
  channel: string;
  pct: number;
  count: number;
};

function toPeriod(value: string | string[] | undefined): ReportPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "qtd" || v === "fy" || v === "mtd") return v;
  return "mtd";
}

export default async function Page({ searchParams }: { searchParams: { period?: string | string[] } }) {
  const period = toPeriod(searchParams.period);
  const { data: analytics, source } = await getTicketAnalytics(period);
  const errored = source === "error";
  const periodLabel = PERIOD_LABELS[period];

  const priorityRows: PriorityRow[] = analytics.byPriority.map((row) => ({
    priority: humanizeStatus(row.priority),
    pct: Number(row.pct.toFixed(1)),
    count: row.count,
  }));

  const channelRows: ChannelRow[] = analytics.byChannel.map((row) => ({
    channel: humanizeStatus(row.channel),
    pct: Number(row.pct.toFixed(1)),
    count: row.count,
  }));

  return (
    <>
      <PageHeader
        title="Citizen Ticket Reports"
        subtitle="Service performance and support quality indicators for citizen tickets."
        back="/helpdesk"
      />
      {/* GAP-HELPDESK-REPORTS-01: period control (MTD / QTD / FY), searchParams-driven. */}
      <ReportPeriodNav current={period} />
      {/* GAP-HELPDESK-REPORTS-04: a single error state for the whole page on
          failure, not a badge plus two separate RefreshErrorStates. */}
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "ticket reports" })} backHref="/helpdesk" />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="🎫" label={`Total Tickets (${periodLabel})`} value={analytics.totalTickets.toLocaleString("en-IN")} />
            <StatCard icon="🔵" label={`Open (${periodLabel})`} value={analytics.openTickets.toLocaleString("en-IN")} />
            <StatCard icon="✅" label={`Resolved (${periodLabel})`} value={analytics.resolvedThisMonth.toLocaleString("en-IN")} />
            <StatCard icon="🚨" label={`SLA Breached (${periodLabel})`} value={analytics.slaBreachedCount.toLocaleString("en-IN")} />
          </StatGrid>
          <div className="grid g-2">
            <div className="card">
              <div className="card-h"><h3>By Priority ({periodLabel})</h3></div>
              {priorityRows.length === 0 ? (
                <EmptyState icon="📊" title="No data" message="Priority breakdown will appear here." />
              ) : (
                <DataTable<PriorityRow>
                  columns={[
                    { key: "priority", label: "Priority" },
                    { key: "count", label: "Count", align: "right" },
                    { key: "pct", label: "% of Total", align: "right", cellType: "percent" },
                  ]}
                  rows={priorityRows}
                  sortable
                  exportable
                  exportFilename={`helpdesk-reports-priority-${period}`}
                />
              )}
            </div>
            <div className="card">
              <div className="card-h"><h3>By Channel ({periodLabel})</h3></div>
              {channelRows.length === 0 ? (
                <EmptyState icon="📊" title="No data" message="Channel breakdown will appear here." />
              ) : (
                <DataTable<ChannelRow>
                  columns={[
                    { key: "channel", label: "Channel" },
                    { key: "count", label: "Count", align: "right" },
                    { key: "pct", label: "%", align: "right", cellType: "percent" },
                  ]}
                  rows={channelRows}
                  sortable
                  exportable
                  exportFilename={`helpdesk-reports-channel-${period}`}
                />
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Performance ({periodLabel})</h3></div>
            <div className="fields">
              <div className="fld"><div className="fl">Avg Resolution Time</div><div className="fv">{formatDurationHours(analytics.avgResolutionHours)}</div></div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
