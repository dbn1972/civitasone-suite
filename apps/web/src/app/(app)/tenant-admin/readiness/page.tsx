import { PageHeader, StatCard, StatGrid, Card, ProgressBar, StatusPill, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getTenantAdminDashboard } from "@/app/_data/loaders";

type ReadinessItem = {
  id: string;
  label: string;
  description: string;
  status: "pass" | "fail" | "in-progress";
};

const readinessChecklist: ReadinessItem[] = [
  { id: "r-001", label: "Users Configured", description: "At least 5 users with roles assigned", status: "pass" },
  { id: "r-002", label: "Modules Enabled", description: "Core modules (Finance, HR, Procurement) activated", status: "pass" },
  { id: "r-003", label: "Security Hardened", description: "MFA enforced, session timeout configured, IP allowlist set", status: "pass" },
  { id: "r-004", label: "Data Migrated", description: "Legacy data imported and validated", status: "in-progress" },
  { id: "r-005", label: "Integrations Connected", description: "Email, SMS, and IDP integrations verified", status: "pass" },
  { id: "r-006", label: "Backup Configured", description: "Automated daily backup with offsite replication", status: "pass" },
  { id: "r-007", label: "Compliance Verified", description: "DPDP and CERT-In requirements met", status: "fail" },
  { id: "r-008", label: "Training Completed", description: "Admin team completed onboarding training", status: "in-progress" },
];

function statusIcon(status: string): string {
  if (status === "pass") return "✅";
  if (status === "fail") return "❌";
  return "🔄";
}

export default async function ReadinessPage() {
  const { data: dashboard, source } = await getTenantAdminDashboard();
  const readiness = dashboard.readiness;

  const passed = readiness
    ? Math.round((readiness.overall / 100) * readinessChecklist.length)
    : readinessChecklist.filter((i) => i.status === "pass").length;
  const total = readinessChecklist.length;
  const overallPct = readiness ? readiness.overall : Math.round((passed / total) * 100);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Readiness Score" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Tenant Readiness Score"
        subtitle="Overall readiness assessment — track configuration progress and go-live checklist completion."
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🎯" iconBg="#eff6ff" label="Overall Readiness" value={`${overallPct}%`} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Passed" value={passed} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={readinessChecklist.filter((i) => i.status === "in-progress").length} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Failed" value={readinessChecklist.filter((i) => i.status === "fail").length} />
      </StatGrid>
      <Card title="Readiness Progress" padding>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            <span>Overall completion</span>
            <span>{overallPct}%</span>
          </div>
          <ProgressBar value={overallPct} color="#16a34a" />
        </div>
      </Card>
      <Card title="Readiness Checklist" padding>
        {readinessChecklist.length === 0 ? (
          <EmptyState icon="🎯" title="No readiness checks configured" message="Readiness checks will appear here once your organisation setup is in progress." />
        ) : (
          <ul aria-label="Readiness items" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {readinessChecklist.map((item) => (
              <li key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
                <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0 }}>{statusIcon(item.status)}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{item.label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>{item.description}</p>
                </div>
                <StatusPill status={item.status === "pass" ? "active" : item.status === "fail" ? "failed" : "in progress"} label={item.status === "pass" ? "Pass" : item.status === "fail" ? "Fail" : "In Progress"} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
