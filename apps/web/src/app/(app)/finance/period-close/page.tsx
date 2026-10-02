import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { ClosePeriodForm } from "./ClosePeriodForm";
import { PeriodsTable } from "./PeriodsTable";
import { getPeriods } from "./periodsLoader";
import { getSessionRoles } from "@/lib/auth/roleGuard";

export default async function PeriodCloseCockpitPage() {
  const { data: periods, source } = await getPeriods();
  // GAP-FINANCE-PERIOD-CLOSE-01: mirror finance-service's period-close role
  // tiers so no one is offered an action that 403s -- soft-close:
  // finance_officer/finance_admin/super_admin; hard-close and reopen:
  // finance_admin/super_admin. Other FINANCE_ROLES members (audit_officer,
  // budget_officer, payroll_admin, ...) see the cockpit read-only.
  const roles = getSessionRoles();
  const canHardClose = roles.some((r) => r === "finance_admin" || r === "super_admin");
  const canReopen = canHardClose;
  const canClose = canHardClose || roles.includes("finance_officer");

  const openCount = periods.filter((p) => p.status === "open").length;
  const softClosedCount = periods.filter((p) => p.status === "soft_close").length;
  const hardClosedCount = periods.filter((p) => p.status === "hard_close").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Period-Close Cockpit"
        subtitle="Track accounting-period status and drive the soft-close, hard-close, and reopen workflow."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🟢" iconBg="#e6f7f0" label="Open" value={openCount} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="Soft-Closed" value={softClosedCount} />
        <StatCard icon="🔒" iconBg="#fef3f2" label="Hard-Closed" value={hardClosedCount} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Tracked Periods" value={periods.length} />
      </StatGrid>

      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Only periods that have been closed or reopened at least once appear below — a period with no history is
        implicitly open. Use the form to soft-close a period for the first time.
      </p>

      {canClose ? <ClosePeriodForm /> : null}

      <Card title="Accounting Periods">
        {source === "error" && periods.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <PeriodsTable periods={periods} canClose={canClose} canHardClose={canHardClose} canReopen={canReopen} />
        )}
      </Card>
    </div>
  );
}
