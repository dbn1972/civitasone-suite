import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { getProjectEscalations } from "@/app/_data/loaders";
import { EscalationsTable } from "./EscalationsTable";

export default async function EscalationsPage() {
  const { data: rows, source } = await getProjectEscalations();

  const active = rows.filter((r) => r.status !== "cleared").length;
  const critical = rows.filter((r) => r.severity === "blocked").length;
  const high = rows.filter((r) => r.severity === "overdue").length;
  const resolvedThisMonth = rows.filter((r) => r.status === "cleared").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Escalations" subtitle="Project risk alerts, escalation queue and resolution tracking." back="/projects" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Active Escalations" value={active} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Critical" value={critical} />
        <StatCard icon="🟠" iconBg="#fffaeb" label="High" value={high} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Resolved This Month" value={resolvedThisMonth} />
      </StatGrid>
      <Card title="Escalation Queue">
        {rows.length === 0 ? (
          <EmptyState icon="🚨" title="No escalations" message="No project escalations have been raised." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <EscalationsTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
