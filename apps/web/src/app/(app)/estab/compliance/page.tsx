import { getEstabCompliance } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { ESTAB_COMMITTEE_WRITE_ROLES } from "@/lib/estab/roles";
import { ComplianceTable, type ComplianceRow } from "./ComplianceTable";
import { complianceRate as rateOf, countEscalated, ESCALATION_DAYS } from "./complianceStats";

export default async function CompliancePage() {
  const { data: items, source } = await getEstabCompliance();
  const errored = source === "error";
  // GAP-ESTAB-COMPLIANCE-03: the comply route is estab-officer only (audit_officer reads),
  // so only those viewers are offered "Mark complied". The service stays the authority.
  const canComply = hasAnyRole(getSessionRoles(), ESTAB_COMMITTEE_WRITE_ROLES);
  const today = todayIST(); // GAP-ESTAB-COMPLIANCE-01: IST calendar day, not UTC.
  // GAP-ESTAB-COMPLIANCE-02: null (→ "—") on an empty register, not a misleading 0%.
  const rate = rateOf(items);
  const openActions = items.filter((c) => c.status === "pending").length;
  const overdue = items.filter((c) => c.status === "overdue").length;
  // GAP-ESTAB-COMPLIANCE-01: escalated = overdue for > ESCALATION_DAYS days
  // (distinct from Overdue), computed on the IST date.
  const escalated = countEscalated(items, today);

  const rows: ComplianceRow[] = items.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    // GAP-ESTAB-COMPLIANCE-04: the service resolves the assignee's name; the raw id is
    // never shown. null = nobody assigned ("—"); "" = assigned but unresolvable.
    assignedTo: c.assignedTo ? (c.assignedToName ?? "") : null,
    due: formatIndianDate(c.dueDate),
    status: c.status.replace(/_/g, " "),
    statusRaw: c.status,
  }));

  return (
    <>
      <PageHeader
        title="Action / Decision Compliance"
        subtitle="Track closure of meeting action items & decisions."
      />
      {/* delta removed — it was a hardcoded "+3%", not a real period-over-period
          change; and counts show "—" rather than a fabricated 0 on load failure. */}
      <StatGrid>
        <StatCard icon="✅" tone="good" label="Compliance Rate" value={errored || rate === null ? "—" : `${rate}%`} />
        <StatCard icon="📋" tone="good" label="Open Actions" value={errored ? "—" : openActions.toLocaleString("en-IN")} />
        <StatCard icon="⏰" tone="warn" label="Overdue" value={errored ? "—" : overdue.toLocaleString("en-IN")} />
        <StatCard icon="🔴" tone="bad" label={`Escalated (> ${ESCALATION_DAYS}d overdue)`} value={errored ? "—" : escalated.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {errored ? (
          <>
            <div className="card-h"><h3>Action items across meetings</h3></div>
            <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "compliance items" })} /></div>
          </>
        ) : items.length === 0 ? (
          <>
            <div className="card-h">
              <h3>Action items across meetings</h3>
            </div>
            <EmptyState icon="✅" title="No compliance items" message="Action items from meetings will appear here." />
          </>
        ) : (
          <ComplianceTable rows={rows} canComply={canComply} />
        )}
      </div>
    </>
  );
}
