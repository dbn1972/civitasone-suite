import { PageHeader, StatCard, StatGrid, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getComplianceOverview } from "@/app/_data/loaders";

function resultColor(result: string): string {
  if (result === "pass") return "#16a34a";
  if (result === "warn") return "#d97706";
  return "#dc2626";
}

function resultIcon(result: string): string {
  if (result === "pass") return "✅";
  if (result === "warn") return "⚠️";
  return "❌";
}

export default async function ComplianceDashboardPage() {
  const { data: overview, source } = await getComplianceOverview();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Compliance" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Compliance Dashboard"
        subtitle="DPDP Act compliance, CERT-In readiness, data retention policy status, and recent compliance checks."
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="DPDP Score" value={`${overview.dpdpScore}%`} />
        <StatCard icon="🛡️" iconBg="#ecfdf3" label="CERT-In Readiness" value={`${overview.certInReadiness}%`} />
        <StatCard icon="🗄️" iconBg="#f1f5f9" label="Data Retention" value={overview.retentionStatus} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Checks Passed" value={`${overview.checks.filter((c) => c.result === "pass").length}/${overview.checks.length}`} />
      </StatGrid>

      {overview.checks.length === 0 ? (
        <Card title="Recent Compliance Checks" padding>
          <EmptyState icon="📋" title="No compliance checks recorded" message="Compliance check results will appear here after your first automated scan." />
        </Card>
      ) : (
        <Card title="Recent Compliance Checks" padding>
          <ol className="timeline" aria-label="Compliance check timeline" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {overview.checks.map((check) => (
              <li key={check.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
                <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0 }}>{resultIcon(check.result)}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{check.title}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>
                    {new Date(check.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: resultColor(check.result), textTransform: "capitalize" }}>
                  {check.result}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </main>
  );
}
