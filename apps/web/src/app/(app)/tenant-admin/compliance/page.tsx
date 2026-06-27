import { PageHeader, StatCard, StatGrid, Card } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";

type ComplianceCheck = {
  id: string;
  timestamp: string;
  title: string;
  result: "pass" | "warn" | "fail";
};

const recentChecks: ComplianceCheck[] = [
  { id: "cc-001", timestamp: "2025-01-15T14:00:00Z", title: "Data retention policy audit", result: "pass" },
  { id: "cc-002", timestamp: "2025-01-14T10:30:00Z", title: "Consent records verification", result: "pass" },
  { id: "cc-003", timestamp: "2025-01-13T16:00:00Z", title: "Cross-border data transfer check", result: "warn" },
  { id: "cc-004", timestamp: "2025-01-12T09:00:00Z", title: "Right to erasure audit", result: "pass" },
  { id: "cc-005", timestamp: "2025-01-11T11:30:00Z", title: "CERT-In incident response readiness", result: "warn" },
  { id: "cc-006", timestamp: "2025-01-10T15:00:00Z", title: "Encryption at rest verification", result: "pass" },
];

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

export default function ComplianceDashboardPage() {
  const dpdpScore = 87;
  const certInReadiness = 72;
  const retentionStatus = "Active";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Compliance" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Compliance Dashboard"
        subtitle="DPDP Act compliance, CERT-In readiness, data retention policy status, and recent compliance checks."
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="DPDP Score" value={`${dpdpScore}%`} />
        <StatCard icon="🛡️" iconBg="#ecfdf3" label="CERT-In Readiness" value={`${certInReadiness}%`} />
        <StatCard icon="🗄️" iconBg="#f1f5f9" label="Data Retention" value={retentionStatus} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Checks Passed" value={`${recentChecks.filter((c) => c.result === "pass").length}/${recentChecks.length}`} />
      </StatGrid>
      <Card title="Recent Compliance Checks" padding>
        <ol className="timeline" aria-label="Compliance check timeline" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {recentChecks.map((check) => (
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
    </main>
  );
}
