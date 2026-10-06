import Link from "next/link";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../_components/ds";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getHelpdeskTicketList, getTicketAnalytics } from "../../_data/loaders";
import { toHumanError } from "@/lib/messages";

export default async function Page() {
  const [{ data: tickets, source: ticketSource }, { data: analytics, source: analyticsSource }] = await Promise.all([
    getHelpdeskTicketList(),
    getTicketAnalytics(),
  ]);
  const ticketsErrored = ticketSource === "error";
  const analyticsErrored = analyticsSource === "error";

  // GAP-HELPDESK-HOME-01: headline stats sourced from analytics (server-side
  // aggregates) so they are correct even when the ticket list is paginated /
  // capped. This is the SAME source /helpdesk/reports uses, so both pages
  // agree (HOME-03).
  //
  // In-progress/pending/resolved are not in the analytics payload today, so
  // we still derive them from the ticket list — but Total/Open/Breached/SLA%
  // come from analytics, which is the authoritative aggregate.
  const inProgress = ticketsErrored ? 0 : tickets.filter((t) => t.status === "in_progress").length;
  const pending = ticketsErrored ? 0 : tickets.filter((t) => t.status === "pending").length;
  const resolved = ticketsErrored ? 0 : tickets.filter((t) => t.status === "resolved" || t.status === "closed").length;

  const slaBreachPct = analyticsErrored
    ? 0
    : analytics.totalTickets > 0
      ? Math.round((analytics.slaBreachedCount / analytics.totalTickets) * 100)
      : 0;

  // GAP-HELPDESK-HOME-02: surface analytics fetch failure visually — an error
  // shows "—" + an error cue, not a silent "0" or blank em dash.
  const avgResolutionDisplay =
    analyticsErrored
      ? "—"
      : analytics.avgResolutionHours > 0
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
      {analyticsErrored && <DataSourceBadge source={analyticsSource} />}

      <StatGrid>
        <StatCard icon="🟠" label="Open" value={analyticsErrored ? "—" : analytics.openTickets.toLocaleString("en-IN")} />
        <StatCard icon="🔵" label="In Progress" value={ticketsErrored ? "—" : inProgress.toLocaleString("en-IN")} />
        <StatCard icon="⏳" label="Pending" value={ticketsErrored ? "—" : pending.toLocaleString("en-IN")} />
        <StatCard icon="✅" label="Resolved / Closed" value={ticketsErrored ? "—" : resolved.toLocaleString("en-IN")} />
        <StatCard icon="🚨" label="SLA Breached" value={analyticsErrored ? "—" : analytics.slaBreachedCount.toLocaleString("en-IN")} />
        <StatCard icon="📊" label="SLA Breach %" value={analyticsErrored ? "—" : `${slaBreachPct}%`} />
        <StatCard icon="⏱" label="Avg Resolution" value={avgResolutionDisplay} />
        <StatCard icon="🎫" label="Total Tickets" value={analyticsErrored ? "—" : analytics.totalTickets.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-h"><h3>Quick Navigation</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {[
            { href: "/helpdesk/tickets", label: "All Tickets", icon: "🎫" },
            { href: "/helpdesk/internal", label: "Internal Ops", icon: "🏢" },
            { href: "/helpdesk/slas", label: "SLA Queue", icon: "⏱" },
            { href: "/helpdesk/reports", label: "Reports", icon: "📊" },
            { href: "/helpdesk/catalogue", label: "Service Catalogue", icon: "📋" },
          ].map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="btn"
              style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 8px", gap: 8, textDecoration: "none" }}
            >
              <span style={{ fontSize: 24 }} aria-hidden="true">{tile.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{tile.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {ticketsErrored ? (
        <RefreshErrorState error={toHumanError("load", { area: "tickets" })} />
      ) : (
        tickets.length === 0 && (
          <EmptyState icon="🎫" title="No tickets yet" message="Create a ticket to get started with helpdesk management." />
        )
      )}
    </>
  );
}
