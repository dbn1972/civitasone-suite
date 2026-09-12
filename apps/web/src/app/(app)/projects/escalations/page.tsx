import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getProjectEscalations } from "@/app/_data/loaders";
import { EscalationsTable } from "./EscalationsTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function EscalationsPage() {
  const result = await getProjectEscalations();
  const { data: rows, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const active = errored ? null : rows.filter((r) => r.status !== "cleared").length;
  const critical = errored ? null : rows.filter((r) => r.severity === "blocked").length;
  const high = errored ? null : rows.filter((r) => r.severity === "overdue").length;
  const resolvedThisMonth = errored ? null : rows.filter((r) => r.status === "cleared").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Escalations" subtitle="Project risk alerts, escalation queue and resolution tracking." back="/projects" />
      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Active Escalations" value={active ?? "—"} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Critical" value={critical ?? "—"} />
        <StatCard icon="🟠" iconBg="#fffaeb" label="High" value={high ?? "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Resolved This Month" value={resolvedThisMonth ?? "—"} />
      </StatGrid>
      <Card title="Escalation Queue">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "escalations" })} backHref="/projects" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="🚨" title="No escalations" message="No project escalations have been raised." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <EscalationsTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
