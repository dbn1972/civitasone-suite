import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjects } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { ProjectsTable, type ProjectRow } from "./ProjectsTable";

export default async function ProjectsListPage() {
  const { data: projects, source } = await getProjects();
  const active = projects.filter((p) => p.status === "active").length;
  const onTrack = projects.filter((p) => p.completionPct > 50).length;
  const atRisk = projects.filter((p) => p.status === "on_hold").length;
  const delayed = projects.filter((p) => p.status === "delayed").length;

  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    projectCode: p.projectCode,
    name: p.name,
    scheme: p.scheme ?? "—",
    department: p.department ?? "—",
    totalBudget: p.totalBudget,
    completionPct: `${p.completionPct.toFixed(1)}%`,
    status: p.status,
  }));

  return (
    <>
      <PageHeader title="Projects" subtitle="All projects with physical progress & RAG status." />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📁" iconBg="#eef0fe" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Track" value={onTrack} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="At Risk" value={atRisk} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Delayed" value={delayed} />
      </StatGrid>
      <Card title="Projects">
        <ProjectsTable rows={rows} source={source} />
      </Card>
    </>
  );
}
