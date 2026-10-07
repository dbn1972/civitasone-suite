import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { getCatalogueOfferings, getRequestBreachReport } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { slaLabel } from "@/lib/slaLabels";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole, HELPDESK_MANAGER_ROLES } from "@/lib/auth/roleGuard";

type Row = {
  id: string;
  ref: string;
  service: string;
  stage: string;
  sla: string;
  escalated: string;
  deadline: string;
  ticketHref: string | null;
};

export default async function Page() {
  // GAP-HELPDESK-CATALOGUE-BREACHES-03: role-gate this tenant-wide breach data
  // to helpdesk managers — requestedBy and stage data should not be visible to
  // every user. DECISION (safest default): restrict to helpdesk_admin / super_admin.
  const sessionRoles = getSessionRoles();
  const isManager = hasAnyRole(sessionRoles, HELPDESK_MANAGER_ROLES);

  const [{ data: report, source }, { data: offerings }] = await Promise.all([
    getRequestBreachReport(),
    getCatalogueOfferings(),
  ]);
  const errored = source === "error";

  // GAP-HELPDESK-CATALOGUE-BREACHES-01: build offering name map to replace raw UUIDs
  const offeringMap = new Map(offerings.map((o) => [o.id, o.name]));

  const rows: Row[] = report.data.map((r) => ({
    id: r.id,
    // Short reference — first 8 chars of the UUID, uppercase
    ref: `SR-${r.id.slice(0, 8).toUpperCase()}`,
    // GAP-HELPDESK-CATALOGUE-BREACHES-01: offering name from the map
    service: offeringMap.get(r.offeringId) ?? "Unknown service",
    stage: r.currentStage ?? "—",
    // GAP-HELPDESK-CATALOGUE-BREACHES-05: SLA label with correct acronym casing
    sla: slaLabel(r.slaStatus),
    // GAP-HELPDESK-CATALOGUE-BREACHES-04: show escalation date, not just "Escalated"
    escalated: r.breachEscalatedAt ? `Escalated ${formatIndianDate(r.breachEscalatedAt)}` : "—",
    deadline: r.resolutionDeadline ? formatIndianDate(r.resolutionDeadline) : "—",
    // GAP-HELPDESK-CATALOGUE-BREACHES-01: ticket link when available
    ticketHref: r.ticketId ? `/helpdesk/tickets/${r.ticketId}` : null,
  }));

  return (
    <>
      <PageHeader
        title="Request SLA Breach Report"
        subtitle="Service requests that have breached or are at risk of breaching their SLA."
        back="/helpdesk/catalogue"
        backLabel="Catalogue"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      {!isManager && (
        <div className="card pad" style={{ marginBottom: 12, color: "var(--mut)", fontSize: "0.875rem" }}>
          This report shows only summary data. Contact a helpdesk administrator for details.
        </div>
      )}
      <StatGrid>
        <StatCard icon="🚨" label="Breached" value={errored ? "—" : report.summary.breached.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" label="At Risk" value={errored ? "—" : report.summary.atRisk.toLocaleString("en-IN")} />
        <StatCard icon="📣" label="Escalated" value={errored ? "—" : report.summary.escalated.toLocaleString("en-IN")} />
        <StatCard icon="📊" label="Tracked" value={errored ? "—" : report.summary.total.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        {/* GAP-HELPDESK-CATALOGUE-BREACHES-02: accurate heading (breached + at risk) */}
        <div className="card-h"><h3>Requests breached or at risk</h3></div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "SLA breach report" })} backHref="/helpdesk/catalogue" />
        ) : rows.length === 0 ? (
          <EmptyState icon="✅" title="No SLA breaches" message="No service requests are breached or at risk." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "ref", label: "Reference" },
              { key: "service", label: "Service" },
              { key: "stage", label: "Stage" },
              { key: "sla", label: "SLA", cellType: "status" },
              { key: "escalated", label: "Escalation" },
              { key: "deadline", label: "Resolution Due" },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter breaches…"
            pageSize={15}
            exportable
            exportFilename="sla-breach-report"
          />
        )}
      </div>
      {/* GAP-HELPDESK-CATALOGUE-BREACHES-05: replaced "My requests" link (requester
          action on a manager report) with a contextual "Back to Catalogue" link.
          PageHeader already has a back link, so this is removed. */}
    </>
  );
}
