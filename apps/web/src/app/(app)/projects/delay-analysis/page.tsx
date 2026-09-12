import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getProjectDelayAnalysis } from "@/app/_data/loaders";
import { DelayAnalysisTable } from "./DelayAnalysisTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function DelayAnalysisPage() {
  const result = await getProjectDelayAnalysis();
  const { data: rows, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const total = errored ? null : rows.length;
  const onTrack = errored ? null : rows.filter((r) => r.rag === "active").length;
  const atRisk = errored ? null : rows.filter((r) => r.rag === "review").length;
  const delayed = errored ? null : rows.filter((r) => r.rag === "overdue").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Delay Analysis" subtitle="RAG dashboard — identify at-risk and delayed projects with root causes." back="/projects" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total Projects" value={total ?? "—"} />
        <StatCard icon="🟢" iconBg="#ecfdf3" label="On Track" value={onTrack ?? "—"} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="At Risk" value={atRisk ?? "—"} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Delayed" value={delayed ?? "—"} />
      </StatGrid>
      <Card title="Project Delay Register">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "project delay analysis" })} backHref="/projects" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📋" title="No delay data" message="No projects have delay analysis data yet." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <DelayAnalysisTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
