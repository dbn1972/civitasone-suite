import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getProjectDelayAnalysis } from "@/app/_data/loaders";
import { DelayAnalysisTable } from "./DelayAnalysisTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { normalizeRag } from "@/lib/rag";

export default async function DelayAnalysisPage() {
  const result = await getProjectDelayAnalysis();
  const { data: rows, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-PROJECTS-DELAY-ANALYSIS-01: normalise every RAG spelling the endpoint
  // might use (green|amber|red OR active|review|overdue) onto the canonical
  // three before bucketing, so a "review" row lands in At Risk rather than no
  // tile at all. Any value normalizeRag() cannot place is counted as "Other"
  // so the tiles always reconcile to Total (an unmapped row is visible, not
  // silently dropped from a monitoring view).
  const total = errored ? null : rows.length;
  const onTrack = errored ? null : rows.filter((r) => normalizeRag(r.rag) === "green").length;
  const atRisk = errored ? null : rows.filter((r) => normalizeRag(r.rag) === "amber").length;
  const delayed = errored ? null : rows.filter((r) => normalizeRag(r.rag) === "red").length;
  const other = errored ? null : rows.filter((r) => normalizeRag(r.rag) === null).length;

  return (
    <div className="page-main wrap">
      <PageHeader title="Delay Analysis" subtitle="RAG dashboard — identify at-risk and delayed projects with root causes." back="/projects" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total Projects" value={total ?? "—"} />
        <StatCard icon="🟢" iconBg="#ecfdf3" label="On Track" value={onTrack ?? "—"} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="At Risk" value={atRisk ?? "—"} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Delayed" value={delayed ?? "—"} />
        {other !== null && other > 0 && (
          <StatCard icon="❔" iconBg="#f3f4f6" label="Other" value={other} />
        )}
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
    </div>
  );
}
