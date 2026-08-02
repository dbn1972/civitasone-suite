import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getExecutionIssues, getExecutionProgress } from "../_data/loaders";
import { ExecutionTable } from "./ExecutionTable";

export default async function ExecutionPage() {
  const [{ data: progress, source: progressSource }, { data: issues, source: issuesSource }] = await Promise.all([
    getExecutionProgress(),
    getExecutionIssues(),
  ]);

  const source = progressSource === "error" || issuesSource === "error" ? "error" : "api";
  const total = progress.length;
  const onTrack = progress.filter((p) => Number(p.percentage ?? 0) >= 80).length;
  const delayed = progress.filter((p) => Number(p.percentage ?? 0) < 50 && Number(p.percentage ?? 0) > 0).length;
  const completed = progress.filter((p) => Number(p.percentage ?? 0) === 100).length;
  const openIssues = issues.filter((i) => i.status === "open").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Execution & Progress"
        subtitle="Scope progress monitoring, photos, and issue tracking."
        back="/works"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏗️" iconBg="#eff6ff" label="Progress Entries" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Track" value={onTrack} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Delayed" value={delayed} />
        <StatCard icon="🎉" iconBg="#f0fdf4" label="Completed" value={completed} />
        <StatCard icon="🚧" iconBg="#fef2f2" label="Open Issues" value={openIssues} />
      </StatGrid>
      <Card title="Execution Progress">
        <ExecutionTable progress={progress} issues={issues} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
