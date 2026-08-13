import Link from "next/link";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../_components/ds";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getHelpdeskTicketList, getTicketAnalytics } from "../../_data/loaders";

export default async function Page() {
  const [{ data: tickets, source: ticketSource }, { data: analytics }] = await Promise.all([
    getHelpdeskTicketList(),
    getTicketAnalytics(),
  ]);

  const open = tickets.filter((t) => t.status === "open").length;
  const inProgress = tickets.filter((t) => t.status === "in_progress").length;
  const pending = tickets.filter((t) => t.status === "pending").length;
  const resolved = tickets.filter((t) => t.status === "resolved" || t.status === "closed").length;
  const breached = tickets.filter((t) => t.slaStatus === "breached").length;
  const total = tickets.length;
  const slaBreachPct = total > 0 ? Math.round((breached / total) * 100) : 0;

  const avgResolutionDisplay =
    analytics.avgResolutionHours > 0
      ? analytics.avgResolutionHours < 24
        ? `${analytics.avgResolutionHours.toFixed(1)}h`
        : `${(analytics.avgResolutionHours / 24).toFixed(1)}d`
      : "—";

  return (
    <>
      <PageHeader
        title="Helpdesk"
        subtitle="Ticket operations, SLA monitoring, and support analytics."
        actions={
          <Link href="/helpdesk/tickets/new" className="btn primary">+ New Ticket</Link>
        }
      />
      {ticketSource === "error" && <DataSourceBadge source={ticketSource} />}

      <StatGrid>
        <StatCard icon="🟠" label="Open" value={open.toLocaleString("en-IN")} />
        <StatCard icon="🔵" label="In Progress" value={inProgress.toLocaleString("en-IN")} />
        <StatCard icon="⏳" label="Pending" value={pending.toLocaleString("en-IN")} />
        <StatCard icon="✅" label="Resolved / Closed" value={resolved.toLocaleString("en-IN")} />
        <StatCard icon="🚨" label="SLA Breached" value={breached.toLocaleString("en-IN")} />
        <StatCard icon="📊" label="SLA Breach %" value={`${slaBreachPct}%`} />
        <StatCard icon="⏱" label="Avg Resolution" value={avgResolutionDisplay} />
        <StatCard icon="🎫" label="Total Tickets" value={total.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-h"><h3>Quick Navigation</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {[
            { href: "/helpdesk/tickets", label: "All Tickets", icon: "🎫" },
            { href: "/helpdesk/internal", label: "Internal Ops", icon: "🏢" },
            { href: "/helpdesk/slas", label: "SLA Monitor", icon: "⏱" },
            { href: "/helpdesk/reports", label: "Reports", icon: "📊" },
            { href: "/helpdesk/catalogue", label: "Service Catalogue", icon: "📋" },
          ].map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="btn"
              style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 8px", gap: 8, textDecoration: "none" }}
            >
              <span style={{ fontSize: 24 }}>{tile.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{tile.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {tickets.length === 0 && (
        <EmptyState icon="🎫" title="No tickets yet" message="Create a ticket to get started with helpdesk management." />
      )}
    </>
  );
}
