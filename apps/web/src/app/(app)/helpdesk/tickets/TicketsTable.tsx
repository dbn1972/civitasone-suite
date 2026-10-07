"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState, HelpTip, StatCard, StatGrid } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PredictionBadge } from "../../../_components/ds/PredictionBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { HELPDESK_PRIORITY_VARIANTS } from "@/lib/helpdesk/priorityVariants";

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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Ticket[]>(
    "helpdesk.tickets",
    tickets,
    source,
    (d) => d.length === 0,
  );

  const [tab, setTab] = useState<string>("All");

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

  // GAP-HELPDESK-TICKETS-02: stat cards computed from the SAME rows the table
  // shows (useSeededResource), so they never disagree with what the user sees.
  // When provenance is "error-no-data" there are genuinely no rows anywhere, so
  // show "—". When provenance is "cached", rows come from IndexedDB — label
  // accordingly.
  const noData = provenance === "error-no-data";
  const breachedCount = noData ? null : rows.filter((t) => t.slaStatus === "breached").length;
  const openCount = noData ? null : rows.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const slaMetPct = noData
    ? null
    : rows.length > 0
      ? Math.round(((rows.length - (breachedCount ?? 0)) / rows.length) * 100)
      : null;
  const staleSuffix = provenance === "cached" ? " (cached)" : "";

  return (
    <>
      {/* GAP-HELPDESK-TICKETS-02: stats derived from the same useSeededResource
          rows, so they agree with the table and with cached data. */}
      <StatGrid>
        <StatCard icon="🎫" label={`Open Tickets${staleSuffix}`} value={openCount !== null ? openCount.toLocaleString("en-IN") : "—"} />
        <StatCard icon="⏱" label="First Response" value="Not available" hint="Not yet measured — no analytics source available." />
        <StatCard icon="✅" label={`SLA Met${staleSuffix}`} value={slaMetPct !== null ? `${slaMetPct}%` : "—"} />
        <StatCard icon="⭐" label="CSAT" value="Not available" hint="Customer satisfaction score — not yet measured." />
      </StatGrid>
      <div className="card">
      <div className="card-h">
        <h3>Tickets</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div role="group" aria-label="Filter tickets by status">
            <Segmented options={[...TABS]} value={tab} onChange={setTab} />
          </div>
          <HelpTip term="Breach Risk">
            Predicted probability the SLA will be breached before resolution; badge shows model confidence level.
          </HelpTip>
        </div>
      </div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        <EmptyState icon="🎫" title="No tickets" message="Citizen tickets will appear here once submitted." />
      ) : (
        <DataTable<Row>
          columns={[
            { key: "ticketNo", label: "Ticket No" },
            { key: "subject", label: "Subject" },
            { key: "requesterName", label: "Requester" },
            { key: "priority", label: "Priority", cellType: "status", statusVariants: HELPDESK_PRIORITY_VARIANTS },
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
                ) : (
                  <span style={{ color: "var(--mut)", fontSize: 13 }}>No prediction</span>
                ),
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
    </>
  );
}
