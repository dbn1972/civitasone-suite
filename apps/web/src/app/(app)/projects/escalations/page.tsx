import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getProjectEscalations } from "@/app/_data/loaders";
import { EscalationsTable } from "./EscalationsTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function EscalationsPage() {
  const result = await getProjectEscalations();
  const { data: rows, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-PROJECTS-ESCALATIONS-01: Critical/High must describe OPEN escalations
  // only — a cleared row that still carried a 'blocked'/'overdue' severity was
  // previously counted as Critical/High. Filter by status !== 'cleared' first.
  const active = errored ? null : rows.filter((r) => r.status !== "cleared").length;
  const critical = errored ? null : rows.filter((r) => r.status !== "cleared" && r.severity === "blocked").length;
  const high = errored ? null : rows.filter((r) => r.status !== "cleared" && r.severity === "overdue").length;
  // GAP-PROJECTS-ESCALATIONS-01: the row shape carries no cleared/resolved
  // DATE, so a "this month" filter cannot be computed honestly — count all
  // cleared rows and label the tile "Resolved" (not "Resolved This Month").
  // A month-scoped tile needs a clearedAt field from the backend (HUMAN REVIEW).
  const resolved = errored ? null : rows.filter((r) => r.status === "cleared").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Escalations" subtitle="Project risk alerts, escalation queue and resolution tracking." back="/projects" />
      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Active Escalations" value={active ?? "—"} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Critical" value={critical ?? "—"} />
        <StatCard icon="🟠" iconBg="#fffaeb" label="High" value={high ?? "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Resolved" value={resolved ?? "—"} />
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
    </div>
  );
}
