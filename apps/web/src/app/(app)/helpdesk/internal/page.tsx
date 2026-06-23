import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";
import { getInternalHelpdeskTickets } from "../../../_data/loaders";

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
          <button className="btn primary">+ New Ticket</button>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎫" iconBg="#fff3e0" label="Total Tickets" value={tickets.length.toLocaleString("en-IN")} />
        <StatCard icon="🔵" iconBg="#eff6ff" label="Open" value={open.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Resolved" value={resolved.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef2f2" label="Critical" value={critical.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Internal Tickets</h3>
          <div className="seg"><span className="on">All</span><span>Open</span><span>Resolved</span></div>
        </div>
        {tickets.length === 0 ? (
          <EmptyState icon="🎫" title="No internal tickets" message="Staff tickets will appear here once submitted." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Subject</th>
                <th>Priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: "monospace" }}>
                    <a href={`/helpdesk/internal/${t.id}`}>{t.id.slice(0, 8).toUpperCase()}</a>
                  </td>
                  <td>{t.subject}</td>
                  <td><StatusPill status={t.priority.toLowerCase()} label={t.priority} /></td>
                  <td><StatusPill status={t.status.toLowerCase().replace(/ /g, "_")} label={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
