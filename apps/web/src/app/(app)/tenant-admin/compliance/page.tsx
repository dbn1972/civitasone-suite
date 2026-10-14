import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getComplianceOverview } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatPercent, formatIndianDateTime } from "@/lib/formatters";
import { ComplianceChecksTable } from "./ComplianceChecksTable";

export default async function ComplianceDashboardPage() {
  const result = await getComplianceOverview();
  const { data: overview } = result;
  const resource = toResourceState(result, (data) => data.checks.length === 0);
  const errored = resource.status === "error";

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Compliance" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Compliance Dashboard"
        subtitle="DPDP Act compliance, CERT-In readiness, data retention policy status, and recent compliance checks."
      />
      {/* GAP-TENANT-ADMIN-COMPLIANCE-04: the error state below already carries a
          RefreshErrorState message; the separate DataSourceBadge is dropped so
          an errored page shows exactly one error message. */}

      <StatGrid>
        {/* GAP-TENANT-ADMIN-COMPLIANCE-03: "—" for a missing/errored score (null),
            never a fabricated "0%" or "undefined%"; a real 0 shows "0.0%". */}
        <StatCard icon="📋" iconBg="#eff6ff" label="DPDP Score" value={errored ? "—" : formatPercent(overview.dpdpScore)} />
        <StatCard icon="🛡️" iconBg="#ecfdf3" label="CERT-In Readiness" value={errored ? "—" : formatPercent(overview.certInReadiness)} />
        <StatCard icon="🗄️" iconBg="#f1f5f9" label="Data Retention" value={errored ? "—" : overview.retentionStatus} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Checks Passed" value={errored ? "—" : `${overview.checks.filter((c) => c.result === "pass").length}/${overview.checks.length}`} />
      </StatGrid>

      {/* GAP-TENANT-ADMIN-COMPLIANCE-02: provenance for the headline scores — how
          they were derived, their scope and as-of — so a board-level figure is
          defensible. Shown only when the service supplied it. */}
      {!errored && overview.provenance ? (
        <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 14px" }} data-testid="compliance-provenance">
          {overview.provenance.method}{" "}
          {overview.provenance.asOf ? <>As of {formatIndianDateTime(overview.provenance.asOf)}. </> : "No controls recorded yet. "}
          {overview.provenance.complete ? null : "Some controls are not yet tested, so scores may change."}
        </p>
      ) : null}

      {errored ? (
        <Card title="Recent Compliance Checks" padding>
          <RefreshErrorState error={toHumanError("load", { area: "compliance checks" })} backHref="/tenant-admin" />
        </Card>
      ) : overview.checks.length === 0 ? (
        <Card title="Recent Compliance Checks" padding>
          <EmptyState icon="📋" title="No compliance checks recorded" message="Compliance check results will appear here after your first automated scan." />
        </Card>
      ) : (
        <Card title="Recent Compliance Checks" padding>
          <ComplianceChecksTable checks={overview.checks} />
        </Card>
      )}
    </div>
  );
}
