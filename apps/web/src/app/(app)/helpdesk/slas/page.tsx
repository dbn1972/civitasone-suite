import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState } from "../../../_components/ds";
import { getBreachedSLATickets } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

type TicketRow = {
  id: string;
  ticketNo: string;
  subject: string;
  requesterName: string;
  priority: string;
  status: string;
  createdAt: string;
  assignedTo: string;
};

export default async function Page() {
  const { data: tickets, source } = await getBreachedSLATickets();

  const breached = tickets.filter((t) => t.slaStatus === "breached");
  const dueSoon = tickets.filter((t) => t.slaStatus === "due_soon").length;
  const withinSla = tickets.filter((t) => t.slaStatus === "within_sla").length;

  const sorted = [...breached].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const rows: TicketRow[] = sorted.map((t) => ({
    id: t.id,
    ticketNo: t.ticketNo,
    subject: t.subject,
    requesterName: t.requesterName,
    priority: t.priority,
    status: t.status.replace(/_/g, " "),
    createdAt: formatIndianDate(t.createdAt),
    assignedTo: t.assignedTo ?? "Unassigned",
  }));

  return (
    <>
      <PageHeader
        title="SLA Queue"
        subtitle="Tickets where SLA has been breached, sorted oldest first."
        back="/helpdesk"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef2f2" label="SLA Breached" value={breached.length.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" iconBg="#fffbeb" label="Due Soon" value={dueSoon.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Within SLA" value={withinSla.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#eef2ff" label="Total Tickets" value={tickets.length.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>Breached SLA tickets</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="✅" title="All clear — no SLA breaches" message="No tickets have exceeded their SLA threshold." />
        ) : (
          <DataTable<TicketRow>
            columns={[
              { key: "ticketNo", label: "Ticket No" },
              { key: "subject", label: "Subject" },
              { key: "requesterName", label: "Requester" },
              { key: "priority", label: "Priority", cellType: "status" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "createdAt", label: "Created" },
              { key: "assignedTo", label: "Assigned To" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/helpdesk/tickets/"
            sortable
            filterable
            filterPlaceholder="Filter SLA queue…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
