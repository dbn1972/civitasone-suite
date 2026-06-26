import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getInternalHelpdeskTickets } from "../../../_data/loaders";
import { InternalTicketsTable } from "./InternalTicketsTable";

export default async function Page() {
  const { data: tickets, source } = await getInternalHelpdeskTickets();

  const open = tickets.filter((t) => t.status === "Open" || t.status === "In Progress").length;
  const resolved = tickets.filter((t) => t.status === "Resolved").length;
  const critical = tickets.filter((t) => t.priority === "Critical").length;

  return (
    <>
      <PageHeader
        title="Internal Helpdesk"
        subtitle="Staff operations queue via helpdesk-service."
        back="/helpdesk"
        actions={
          <Link href="/helpdesk/tickets/new" className="btn primary">+ New Ticket</Link>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎫" iconBg="#fff3e0" label="Total Tickets" value={tickets.length.toLocaleString("en-IN")} />
        <StatCard icon="🔵" iconBg="#eff6ff" label="Open" value={open.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Resolved" value={resolved.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef2f2" label="Critical" value={critical.toLocaleString("en-IN")} />
      </StatGrid>
      <InternalTicketsTable tickets={tickets} />
    </>
  );
}
