"use client";

import Link from "next/link";
import { StatusPill, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Ticket = {
  id: string;
  ticketNo: string;
  subject: string;
  requesterName: string;
  priority: string;
  slaStatus: string;
  status: string;
} & Record<string, unknown>;

export function TicketsTable({ tickets, source = "api" }: { tickets: Ticket[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Ticket[]>(
    "helpdesk.tickets",
    tickets,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Tickets</h3>
        <div className="seg">
          <span className="on">All</span>
          <span>Open</span>
          <span>Pending</span>
          <span>Resolved</span>
        </div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="🎫" title="No tickets" message="Citizen tickets will appear here once submitted." />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Ticket No</th>
              <th>Subject</th>
              <th>Requester</th>
              <th>Priority</th>
              <th>SLA</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="clickable">
                <td><Link href={`/helpdesk/tickets/${t.id}`}>{t.ticketNo}</Link></td>
                <td>{t.subject}</td>
                <td>{t.requesterName}</td>
                <td><StatusPill status={t.priority} /></td>
                <td><StatusPill status={t.slaStatus} label={t.slaStatus.replace(/_/g, " ")} /></td>
                <td><StatusPill status={t.status} label={t.status.replace(/_/g, " ")} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
