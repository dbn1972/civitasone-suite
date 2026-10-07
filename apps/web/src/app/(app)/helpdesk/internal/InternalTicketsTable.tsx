"use client";

import { useState } from "react";
import type { InternalHelpdeskTicketSummary } from "@civitasone/types";
import { DataTable, Segmented, EmptyState } from "../../../_components/ds";

type TicketRow = {
  id: string;
  ticketId: string;
  subject: string;
  priority: string;
  status: string;
} & Record<string, unknown>;

// GAP-HELPDESK-INTERNAL-04: include Closed in the Resolved tab; an "All" tab
// catches every status (including unknown ones like Pending / On Hold).
const TABS = ["All", "Open", "Resolved"] as const;

const OPEN_STATUSES = new Set(["Open", "In Progress"]);
const RESOLVED_STATUSES = new Set(["Resolved", "Closed"]);

export function InternalTicketsTable({
  tickets,
}: {
  tickets: InternalHelpdeskTicketSummary[];
}) {
  const [tab, setTab] = useState<string>("All");

  const tableRows: TicketRow[] = tickets.map((t) => ({
    id: t.id,
    // GAP-HELPDESK-INTERNAL-02 / DETAIL-05: show a short reference instead of
    // a truncated UUID — formatted the same way on list and detail for consistency.
    ticketId: `INT-${t.id.slice(0, 8).toUpperCase()}`,
    subject: t.subject,
    priority: t.priority,
    status: t.status,
  }));

  const filtered =
    tab === "Open"
      ? tableRows.filter((r) => OPEN_STATUSES.has(r.status))
      : tab === "Resolved"
        ? tableRows.filter((r) => RESOLVED_STATUSES.has(r.status))
        : tableRows;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Internal Tickets</h3>
        <div role="group" aria-label="Filter internal tickets by status">
          <Segmented options={[...TABS]} value={tab} onChange={setTab} />
        </div>
      </div>
      {tableRows.length === 0 ? (
        <EmptyState icon="🎫" title="No internal tickets" message="Staff tickets will appear here once submitted." />
      ) : (
        <DataTable<TicketRow>
          columns={[
            { key: "ticketId", label: "Ticket" },
            { key: "subject", label: "Subject" },
            { key: "priority", label: "Priority", cellType: "status" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={filtered}
          rowLinkKey="id"
          rowLinkPrefix="/helpdesk/internal/"
          sortable
          filterable
          filterPlaceholder="Filter internal tickets…"
          pageSize={15}
        />
      )}
    </div>
  );
}
