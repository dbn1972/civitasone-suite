"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState } from "../../../_components/ds";
import { PredictionBadge } from "../../../_components/ds/PredictionBadge";
import { useSeededResource } from "@/lib/sync/resource";

type Ticket = {
  id: string;
  ticketNo: string;
  subject: string;
  requesterName: string;
  priority: string;
  slaStatus: string;
  status: string;
  breachRisk?: {
    probability: number;
    confidence: number;
    factors?: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }>;
    isFallback?: boolean;
  } | null;
} & Record<string, unknown>;

type Row = {
  id: string;
  ticketNo: string;
  subject: string;
  requesterName: string;
  priority: string;
  slaStatus: string;
  status: string;
  breachRisk?: Ticket["breachRisk"];
};

const TABS = ["All", "Open", "Pending", "Resolved"] as const;

export function TicketsTable({ tickets, source = "api" }: { tickets: Ticket[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Ticket[]>(
    "helpdesk.tickets",
    tickets,
    source,
    (d) => d.length === 0,
  );

  const [tab, setTab] = useState<string>("All");

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const tableRows: Row[] = rows.map((t) => ({
    id: t.id,
    ticketNo: t.ticketNo,
    subject: t.subject,
    requesterName: t.requesterName,
    priority: t.priority,
    slaStatus: t.slaStatus.replace(/_/g, " "),
    status: t.status.replace(/_/g, " "),
    breachRisk: t.breachRisk ?? undefined,
  }));

  const filtered =
    tab === "Open"
      ? tableRows.filter((r) => /^(open|in progress)$/i.test(r.status))
      : tab === "Pending"
        ? tableRows.filter((r) => /pending/i.test(r.status))
        : tab === "Resolved"
          ? tableRows.filter((r) => /resolved/i.test(r.status))
          : tableRows;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Tickets</h3>
        <div role="group" aria-label="Filter tickets by status">
          <Segmented options={[...TABS]} value={tab} onChange={setTab} />
        </div>
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="🎫" title="No tickets" message="Citizen tickets will appear here once submitted." />
      ) : (
        <DataTable<Row>
          columns={[
            { key: "ticketNo", label: "Ticket No" },
            { key: "subject", label: "Subject" },
            { key: "requesterName", label: "Requester" },
            { key: "priority", label: "Priority", cellType: "status" },
            { key: "slaStatus", label: "SLA", cellType: "status" },
            { key: "status", label: "Status", cellType: "status" },
            {
              key: "breachRisk" as keyof Row & string,
              label: "Breach Risk",
              render: (row: Row) =>
                row.breachRisk ? (
                  <PredictionBadge
                    confidence={row.breachRisk.confidence}
                    label={`${Math.round(row.breachRisk.probability * 100)}% breach`}
                    factors={row.breachRisk.factors}
                    isFallback={row.breachRisk.isFallback}
                  />
                ) : null,
            },
          ]}
          rows={filtered}
          rowLinkKey="id"
          rowLinkPrefix="/helpdesk/tickets/"
          sortable
          filterable
          filterPlaceholder="Filter tickets…"
          pageSize={15}
        />
      )}
    </div>
  );
}
