import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState, StatusPill } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getComplianceOverview } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatPercent } from "@/lib/formatters";

export default async function ComplianceDashboardPage() {
  const result = await getComplianceOverview();
  const { data: overview } = result;
  const resource = toResourceState(result, (data) => data.checks.length === 0);
  const errored = resource.status === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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
          <ol className="timeline" aria-label="Compliance check timeline" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {overview.checks.map((check) => (
              <li key={check.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{check.title}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>
                    {new Date(check.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                {/* GAP-TENANT-ADMIN-COMPLIANCE-01: token-based, contrast-checked
                    pill instead of inline amber/green hex text. */}
                <StatusPill status={check.result} />
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
