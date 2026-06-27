import { PageHeader, StatCard, StatGrid, Card, ProgressBar, StatusPill } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";

type InstallStep = {
  id: string;
  label: string;
  description: string;
  status: "completed" | "pending" | "in-progress";
  order: number;
};

const installSteps: InstallStep[] = [
  { id: "step-001", label: "Database Migration", description: "Schema creation and seed data applied", status: "completed", order: 1 },
  { id: "step-002", label: "Admin User Created", description: "Super admin account provisioned with MFA", status: "completed", order: 2 },
  { id: "step-003", label: "Core Modules Installed", description: "Finance, HR, Procurement modules activated", status: "completed", order: 3 },
  { id: "step-004", label: "Identity Provider Connected", description: "SSO/OIDC integration configured and tested", status: "completed", order: 4 },
  { id: "step-005", label: "Email & Notifications", description: "SMTP and push notification channels verified", status: "completed", order: 5 },
  { id: "step-006", label: "Security Hardening", description: "MFA enforcement, session policies, IP allowlist", status: "in-progress", order: 6 },
  { id: "step-007", label: "Data Import", description: "Legacy data migration and validation", status: "pending", order: 7 },
  { id: "step-008", label: "Go-Live Verification", description: "Final readiness check and production sign-off", status: "pending", order: 8 },
];

function stepIcon(status: string): string {
  if (status === "completed") return "✅";
  if (status === "in-progress") return "🔄";
  return "⬜";
}

export default function InstallStatusPage() {
  const completed = installSteps.filter((s) => s.status === "completed").length;
  const total = installSteps.length;
  const progressPct = Math.round((completed / total) * 100);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Installer Status" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Installer Status"
        subtitle="Setup wizard progress — track completed and pending installation steps."
        actions={
          <a href="/install" className="btn primary" role="link" aria-label="Go to main installer page" style={{ minHeight: 44 }}>
            Open Installer
          </a>
        }
      />

      <StatGrid>
        <StatCard icon="🚀" iconBg="#eff6ff" label="Progress" value={`${progressPct}%`} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={installSteps.filter((s) => s.status === "in-progress").length} />
        <StatCard icon="⬜" iconBg="#f1f5f9" label="Pending" value={installSteps.filter((s) => s.status === "pending").length} />
      </StatGrid>
      <Card title="Setup Progress" padding>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            <span>Installation completion</span>
            <span>{completed}/{total} steps</span>
          </div>
          <ProgressBar value={progressPct} color="#2563eb" />
        </div>
      </Card>
      <Card title="Installation Steps" padding>
        <ol aria-label="Installation steps" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {installSteps.map((step) => (
            <li key={step.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
              <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0 }}>{stepIcon(step.status)}</span>
              <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--bg2, #f8fafc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0, border: "1px solid var(--border, #e2e8f0)" }}>
                {step.order}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{step.label}</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>{step.description}</p>
              </div>
              <StatusPill status={step.status === "completed" ? "completed" : step.status === "in-progress" ? "in progress" : "pending"} label={step.status === "completed" ? "Done" : step.status === "in-progress" ? "In Progress" : "Pending"} />
            </li>
          ))}
        </ol>
      </Card>
    </main>
  );
}
