import { PageHeader, StatCard, StatGrid, Card, ProgressBar, StatusPill, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getInstallSteps } from "@/app/_data/loaders";

function stepIcon(status: string): string {
  if (status === "completed") return "✅";
  if (status === "in_progress") return "🔄";
  return "⬜";
}

export default async function InstallStatusPage() {
  const { data: installSteps, source } = await getInstallSteps();
  const completed = installSteps.filter((s) => s.status === "completed").length;
  const total = installSteps.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

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
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🚀" iconBg="#eff6ff" label="Progress" value={`${progressPct}%`} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={installSteps.filter((s) => s.status === "in_progress").length} />
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

      {installSteps.length === 0 ? (
        <Card title="Installation Steps" padding>
          <EmptyState icon="🚀" title="No installation steps found" message="Run the installer to see setup progress here." action={<a href="/install" className="btn primary">Open Installer</a>} />
        </Card>
      ) : (
        <Card title="Installation Steps" padding>
          <ol aria-label="Installation steps" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {installSteps.map((step, idx) => (
              <li key={step.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
                <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0 }}>{stepIcon(step.status)}</span>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--bg2, #f8fafc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0, border: "1px solid var(--border, #e2e8f0)" }}>
                  {step.stepNo ?? idx + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{step.title}</p>
                  {step.description && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>{step.description}</p>}
                </div>
                <StatusPill status={step.status === "completed" ? "completed" : step.status === "in_progress" ? "in progress" : "pending"} label={step.status === "completed" ? "Done" : step.status === "in_progress" ? "In Progress" : "Pending"} />
              </li>
            ))}
          </ol>
        </Card>
      )}
    </main>
  );
}
