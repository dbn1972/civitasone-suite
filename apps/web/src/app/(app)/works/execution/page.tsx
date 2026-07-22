import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { ExecutionTable } from "./ExecutionTable";

type ApiProgress = Record<string, unknown>;

async function getProgress() {
  return fetchJson<unknown, ApiProgress[]>("/api/v1/works/execution/progress", [], {
    telemetryKey: "works.execution",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiProgress[] })?.data;
      return Array.isArray(arr) ? (arr as ApiProgress[]) : null;
    },
  });
}

export default async function ExecutionPage() {
  const { data: progress, source } = await getProgress();

  const total = progress.length;
  const onTrack = progress.filter((p) => Number(p.percentage ?? 0) >= 80).length;
  const delayed = progress.filter((p) => Number(p.percentage ?? 0) < 50 && Number(p.percentage ?? 0) > 0).length;
  const completed = progress.filter((p) => Number(p.percentage ?? 0) === 100).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Execution & Progress"
        subtitle="Scope progress monitoring, photos, and issue tracking."
        back="/works"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏗️" iconBg="#eff6ff" label="Active Works" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Track" value={onTrack} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Delayed" value={delayed} />
        <StatCard icon="🎉" iconBg="#f0fdf4" label="Completed" value={completed} />
      </StatGrid>
      <Card title="Execution Progress">
        <ExecutionTable progress={progress} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
