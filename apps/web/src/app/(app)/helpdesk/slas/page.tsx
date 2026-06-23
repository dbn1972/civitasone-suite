import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";
import { getBreachedSLATickets } from "../../../_data/loaders";
import Link from "next/link";

export default async function Page() {
  const { data: tickets, source } = await getBreachedSLATickets();

  const breached = tickets.filter((t) => t.slaStatus === "breached");
  const dueSoon = tickets.filter((t) => t.slaStatus === "due_soon").length;
  const withinSla = tickets.filter((t) => t.slaStatus === "within_sla").length;

  const sorted = [...breached].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

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
        {sorted.length === 0 ? (
          <EmptyState icon="✅" title="All clear — no SLA breaches" message="No tickets have exceeded their SLA threshold." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Ticket No</th>
                <th>Subject</th>
                <th>Requester</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Created</th>
                <th>Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id} className="clickable">
                  <td><Link href={`/helpdesk/tickets/${t.id}`}>{t.ticketNo}</Link></td>
                  <td>{t.subject}</td>
                  <td>{t.requesterName}</td>
                  <td><StatusPill status={t.priority} /></td>
                  <td><StatusPill status={t.status} label={t.status.replace(/_/g, " ")} /></td>
                  <td>{t.createdAt.slice(0, 10)}</td>
                  <td>{t.assignedTo ?? "Unassigned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
