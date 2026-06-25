import { Suspense } from "react";
import { PageHeader, StatCard, StatGrid, Card, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Breadcrumbs } from "../_components/Breadcrumbs";
import { InstancesTable } from "../_components/InstancesTable";
import { getInstances, getAnalyticsSummary, titleCase } from "../_data/workflowData";

export default async function WorkflowInstancesPage() {
  const [{ data: instances, source }, { data: analytics }] = await Promise.all([
    getInstances(),
    getAnalyticsSummary(),
  ]);

  const active =
    (analytics.instancesByStatus["active"] ?? 0) +
    (analytics.instancesByStatus["running"] ?? 0);
  const completed = analytics.instancesByStatus["completed"] ?? 0;
  const cancelled =
    (analytics.instancesByStatus["cancelled"] ?? 0) +
    (analytics.instancesByStatus["canceled"] ?? 0);

  return (
    <>
      <Breadcrumbs items={[{ label: "Workflow", href: "/workflow" }, { label: "Instances" }]} />
      <PageHeader
        title="Workflow — Instances"
        subtitle="Running and completed process instances, loaded live from the workflow service."
        back="/workflow"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="🧩" iconBg="#eef2ff" label="Total" value={analytics.totalInstances || instances.length} />
        <StatCard icon="⏳" iconBg="#fff7ed" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Completed" value={completed} />
        <StatCard icon="🚫" iconBg="#fef2f2" label="Cancelled" value={cancelled} />
      </StatGrid>

      <div style={{ marginTop: 18 }}>
        <Card title="Instances">
          {source === "error" ? (
            <div className="pad">
              <EmptyState
                icon="⚠️"
                title="Could not load instances"
                message="The workflow service did not return data. Check that you are signed in and the service is reachable."
              />
            </div>
          ) : instances.length === 0 ? (
            <div className="pad">
              <EmptyState icon="🧩" title="No instances yet" message="Process instances will appear here once workflows are started." />
            </div>
          ) : (
            <div className="pad">
              <Suspense fallback={null}>
                <InstancesTable instances={instances} />
              </Suspense>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
