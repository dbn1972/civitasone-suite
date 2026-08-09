import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getHelpdeskTicketList } from "../../../_data/loaders";
import { TicketsTable } from "./TicketsTable";

export default async function Page() {
  const { data: tickets, source } = await getHelpdeskTicketList();

  const breached = tickets.filter((t) => t.slaStatus === "breached").length;
  const slaMetPct = tickets.length > 0
    ? Math.round(((tickets.length - breached) / tickets.length) * 100)
    : 100;
  const open = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;

  // First Response: not calculable from ticket list data alone (no firstResponseAt field).
  // Show "—" honestly until a dedicated analytics endpoint provides this metric.
  const firstResponseDisplay = "—";

  // CSAT: no real CSAT endpoint exists yet — show "—" rather than a hardcoded value.
  const csatDisplay = "—";

  return (
    <>
      <PageHeader
        title="Citizen Tickets"
        subtitle="Tickets, SLAs, agents, queues and knowledge base."
        back="/helpdesk"
        backLabel="Helpdesk"
        actions={
          <>
            <PrintExportButton label="Export" documentTitle="Helpdesk Tickets" />
            <Link href="/helpdesk/tickets/new" className="btn primary">+ New Ticket</Link>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎫" iconBg="#fff3e0" label="Open Tickets" value={open.toLocaleString("en-IN")} />
        <StatCard icon="⏱" iconBg="#fff3e0" label="First Response" value={firstResponseDisplay} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="SLA Met" value={`${slaMetPct}%`} />
        <StatCard icon="⭐" iconBg="#fffbeb" label="CSAT" value={csatDisplay} />
      </StatGrid>
      <TicketsTable tickets={tickets} source={source} />
    </>
  );
}
