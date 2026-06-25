import { PageHeader, StatCard, StatGrid, Card, EmptyState } from "../../_components/ds";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { LinkTiles } from "../../_components/LinkTiles";
import { getAnalyticsSummary, formatDuration, titleCase } from "./_data/workflowData";

export default async function WorkflowHubPage() {
  const { data: a, source } = await getAnalyticsSummary();

  const pendingInstances =
    (a.instancesByStatus["active"] ?? 0) +
    (a.instancesByStatus["pending"] ?? 0) +
    (a.instancesByStatus["running"] ?? 0);

  return (
    <>
      <PageHeader
        title="Workflow & BPM"
        subtitle="Process definitions, running instances, task inbox and SLA analytics — live from the workflow service."
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="🧩" iconBg="#eef2ff" label="Total instances" value={a.totalInstances} />
        <StatCard icon="⏳" iconBg="#fff7ed" label="In progress" value={pendingInstances} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Completed" value={a.completedCount} />
        <StatCard
          icon="⏱"
          iconBg="#faf5ff"
          label="Avg cycle time"
          value={formatDuration(a.avgCycleTimeSeconds)}
        />
      </StatGrid>

      <div className="grid g-2" style={{ marginTop: 18 }}>
        <Card title="SLA health" padding>
          <div className="fields">
            <div className="field">
              <span className="label">Breach rate</span>
              <span>{(a.slaBreachRate * 100).toFixed(1)}%</span>
            </div>
            <div className="field">
              <span className="label">Breached tasks</span>
              <span>{a.slaBreachedTasks}</span>
            </div>
            <div className="field">
              <span className="label">SLA-tracked tasks</span>
              <span>{a.slaTrackedTasks}</span>
            </div>
            <div className="field">
              <span className="label">Escalations</span>
              <span>{a.escalations}</span>
            </div>
          </div>
        </Card>

        <Card title="Instances by status" padding>
          {Object.keys(a.instancesByStatus).length === 0 ? (
            <EmptyState icon="📊" title="No instances yet" message="Status breakdown appears once workflows run." />
          ) : (
            <div className="fields">
              {Object.entries(a.instancesByStatus).map(([status, count]) => (
                <div className="field" key={status}>
                  <span className="label">{titleCase(status)}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 18 }}>
        <LinkTiles
          columns="three"
          tiles={[
            { title: "My tasks", href: "/workflow/my-tasks", description: "Your task inbox — claim, approve, return or reject" },
            { title: "Instances", href: "/workflow/list", description: "Running & completed process instances" },
            { title: "Definitions", href: "/workflow/definitions", description: "Process definitions, versions and graphs" },
          ]}
        />
      </div>
    </>
  );
}
