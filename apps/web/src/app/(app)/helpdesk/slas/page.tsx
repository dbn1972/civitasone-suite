import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getSlaTickets } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { SlaQueueTabs, type SlaBucket } from "./SlaQueueTabs";
import { getSessionRoles, hasAnyRole, HELPDESK_MANAGER_ROLES } from "@/lib/auth/roleGuard";
import { HELPDESK_PRIORITY_VARIANTS } from "@/lib/helpdesk/priorityVariants";

// GAP-HELPDESK-SLAS-03: priority sort weight — Critical outranks older Low.
const PRIORITY_WEIGHT: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type TicketRow = {
  id: string;
  ticketNo: string;
  subject: string;
  requesterName: string;
  priority: string;
  priorityWeight: number;
  status: string;
  createdAt: string;
  assignedTo: string;
};

function toBucket(value: string | string[] | undefined): SlaBucket {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "due_soon" || v === "within_sla" || v === "breached") return v;
  return "breached";
}

const BUCKET_TITLES: Record<SlaBucket, string> = {
  breached: "Breached SLA tickets",
  due_soon: "Due soon tickets",
  within_sla: "Within SLA tickets",
};

export default async function Page({ searchParams }: { searchParams: { bucket?: string | string[] } }) {
  const { data: tickets, source, bucketSources } = await getSlaTickets();
  const errored = source === "error";
  // GAP-HELPDESK-SLAS-04: only managers may export (requesterName is PII).
  const canExport = hasAnyRole(getSessionRoles(), HELPDESK_MANAGER_ROLES);

  const bucket = toBucket(searchParams.bucket);

  const breached = tickets.filter((t) => t.slaStatus === "breached");
  const dueSoon = tickets.filter((t) => t.slaStatus === "due_soon");
  const withinSla = tickets.filter((t) => t.slaStatus === "within_sla");

  // GAP-HELPDESK-SLAS-02: surface errors per-bucket — a failing Due Soon
  // fetch should not blank the Breached table.
  const bucketErrored = bucketSources?.[bucket] === "error";
  const allErrored = bucketSources
    ? Object.values(bucketSources).every((s) => s === "error")
    : errored;

  const bucketTickets =
    bucket === "due_soon" ? dueSoon
      : bucket === "within_sla" ? withinSla
        : breached;

  // GAP-HELPDESK-SLAS-03: sort by priority weight (Critical first) then
  // createdAt ascending — a Critical overdue outranks an older Low ticket.
  const sorted = [...bucketTickets].sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority.toLowerCase()] ?? 2;
    const pb = PRIORITY_WEIGHT[b.priority.toLowerCase()] ?? 2;
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const rows: TicketRow[] = sorted.map((t) => ({
    id: t.id,
    ticketNo: t.ticketNo,
    subject: t.subject,
    requesterName: t.requesterName,
    priority: t.priority,
    priorityWeight: PRIORITY_WEIGHT[t.priority.toLowerCase()] ?? 2,
    status: t.status.replace(/_/g, " "),
    createdAt: formatIndianDate(t.createdAt),
    assignedTo: t.assignedTo ?? "Unassigned",
  }));

  return (
    <>
      {/* GAP-HELPDESK-SLAS-05: one name — "SLA Queue" everywhere (route,
          title, home tile updated in helpdesk/page.tsx). */}
      <PageHeader
        title="SLA Queue"
        subtitle="Tickets by SLA status, sorted by priority."
        back="/helpdesk"
      />
      <StatGrid>
        <StatCard
          icon="🚨"
          label="SLA Breached"
          value={bucketSources?.breached === "error" ? "—" : breached.length.toLocaleString("en-IN")}
          href="/helpdesk/slas?bucket=breached"
        />
        <StatCard
          icon="⚠️"
          label="Due Soon"
          value={bucketSources?.due_soon === "error" ? "—" : dueSoon.length.toLocaleString("en-IN")}
          href="/helpdesk/slas?bucket=due_soon"
        />
        <StatCard
          icon="✅"
          label="Within SLA"
          value={bucketSources?.within_sla === "error" ? "—" : withinSla.length.toLocaleString("en-IN")}
          href="/helpdesk/slas?bucket=within_sla"
        />
        <StatCard icon="📊" label="Total Tickets" value={allErrored ? "—" : tickets.length.toLocaleString("en-IN")} />
      </StatGrid>
      {/* GAP-HELPDESK-SLAS-01: bucket tabs let agents drill into any of the
          three buckets, not just breached. */}
      <SlaQueueTabs current={bucket} />
      <div className="card">
        <div className="card-h"><h3>{BUCKET_TITLES[bucket]}</h3></div>
        {bucketErrored ? (
          <RefreshErrorState error={toHumanError("load", { area: "SLA queue" })} backHref="/helpdesk" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={bucket === "breached" ? "✅" : "📊"}
            title={bucket === "breached" ? "All clear — no SLA breaches" : `No ${bucket.replace(/_/g, " ")} tickets`}
            message={bucket === "breached" ? "No tickets have exceeded their SLA threshold." : "No tickets in this bucket."}
          />
        ) : (
          <DataTable<TicketRow>
            columns={[
              { key: "ticketNo", label: "Ticket No" },
              { key: "subject", label: "Subject" },
              { key: "requesterName", label: "Requester" },
              { key: "priority", label: "Priority", cellType: "status", statusVariants: HELPDESK_PRIORITY_VARIANTS },
              { key: "status", label: "Status", cellType: "status" },
              { key: "createdAt", label: "Created" },
              { key: "assignedTo", label: "Assigned To" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/helpdesk/tickets/"
            sortable
            filterable
            filterPlaceholder="Filter tickets…"
            pageSize={15}
            exportable={canExport}
            exportFilename={canExport ? `sla-${bucket}-tickets` : undefined}
          />
        )}
      </div>
    </>
  );
}
