import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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

  return (
    <>
      <PageHeader
        title="Citizen Tickets"
        subtitle="Tickets, SLAs, agents, queues and knowledge base."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">+ New Ticket</button>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎫" iconBg="#fff3e0" label="Open Tickets" value={open.toLocaleString("en-IN")} delta="-12" up />
        <StatCard icon="⏱" iconBg="#fff3e0" label="First Response" value="18m" delta="-4m" up />
        <StatCard icon="✅" iconBg="#ecfdf5" label="SLA Met" value={`${slaMetPct}%`} delta="+2%" up />
        <StatCard icon="⭐" iconBg="#fffbeb" label="CSAT" value="4.6" delta="+0.1" up />
      </StatGrid>
      <TicketsTable tickets={tickets} source={source} />
    </>
  );
}
