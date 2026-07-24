import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState } from "../../../../_components/ds";
import { getRequestBreachReport } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

type Row = {
  id: string;
  stage: string;
  sla: string;
  escalated: string;
  deadline: string;
};

export default async function Page() {
  const { data: report, source } = await getRequestBreachReport();

  const rows: Row[] = report.data.map((r) => ({
    id: r.id,
    stage: r.currentStage ?? "—",
    sla: r.slaStatus.replace(/_/g, " "),
    escalated: r.breachEscalatedAt ? "Escalated" : "—",
    deadline: r.resolutionDeadline ? formatIndianDate(r.resolutionDeadline) : "—",
  }));

  return (
    <>
      <PageHeader
        title="Request SLA Breach Report"
        subtitle="Service requests that have breached or are at risk of breaching their SLA."
        back="/helpdesk/catalogue"
        backLabel="Catalogue"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef2f2" label="Breached" value={report.summary.breached.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" iconBg="#fffbeb" label="At Risk" value={report.summary.atRisk.toLocaleString("en-IN")} />
        <StatCard icon="📣" iconBg="#eef2ff" label="Escalated" value={report.summary.escalated.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#ecfeff" label="Tracked" value={report.summary.total.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>Breached service requests</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="✅" title="No SLA breaches" message="No service requests have breached their SLA." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "id", label: "Request" },
              { key: "stage", label: "Stage" },
              { key: "sla", label: "SLA", cellType: "status" },
              { key: "escalated", label: "Escalation", cellType: "status" },
              { key: "deadline", label: "Resolution Due" },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter breaches…"
            pageSize={15}
          />
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <Link href="/helpdesk/catalogue/my-requests" className="btn ghost" style={{ minHeight: 40 }}>My requests</Link>
      </div>
    </>
  );
}
