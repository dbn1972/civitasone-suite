import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { getProjectWbs } from "@/app/_data/loaders";
import { WbsTree } from "./WbsTree";

export default async function WbsPage() {
  const { data: nodes, source } = await getProjectWbs();

  const total = nodes.length;
  const completed = nodes.filter((n) => n.status === "completed").length;
  const inProgress = nodes.filter((n) => n.status === "in progress" || n.status === "in_progress").length;
  const notStarted = nodes.filter((n) => n.status === "pending" || n.status === "planned").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Work Breakdown Structure" subtitle="Hierarchical view of project phases, stages and activities." back="/projects" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total Activities" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={inProgress} />
        <StatCard icon="⏳" iconBg="#f1f5f9" label="Not Started" value={notStarted} />
      </StatGrid>
      <Card title="WBS Hierarchy">
        {nodes.length === 0 ? (
          <EmptyState icon="📋" title="No WBS items" message="No work breakdown structure items have been created. Create tasks in a project to see the WBS." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <WbsTree nodes={nodes} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
