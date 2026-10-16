import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getProjectWbs } from "@/app/_data/loaders";
import { WbsTree } from "./WbsTree";
import { countWbsNodes } from "./wbsCounts";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function WbsPage() {
  const result = await getProjectWbs();
  const { data: nodes, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-PROJECTS-WBS-02: bucket every node into exactly one tile so the four
  // status tiles always sum to Total (previously "blocked" and any other
  // status fell into no tile). See wbsCounts.ts.
  const counts = errored ? null : countWbsNodes(nodes);

  return (
    <div className="page-main wrap">
      <PageHeader title="Work Breakdown Structure" subtitle="Hierarchical view of project phases, stages and activities." back="/projects" />
      <StatGrid>
        <StatCard icon="📋" tone="neutral" label="Total Activities" value={counts?.total ?? "—"} />
        <StatCard icon="✅" tone="good" label="Completed" value={counts?.completed ?? "—"} />
        <StatCard icon="🔄" tone="warn" label="In Progress" value={counts?.inProgress ?? "—"} />
        <StatCard icon="🚧" tone="bad" label="Blocked" value={counts?.blocked ?? "—"} />
        <StatCard icon="⏳" tone="neutral" label="Not Started" value={counts?.notStarted ?? "—"} />
      </StatGrid>
      <Card title="WBS Hierarchy">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "work breakdown structure" })} backHref="/projects" />
          </div>
        ) : nodes.length === 0 ? (
          <EmptyState icon="📋" title="No WBS items" message="No work breakdown structure items yet." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <WbsTree nodes={nodes} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </div>
  );
}
