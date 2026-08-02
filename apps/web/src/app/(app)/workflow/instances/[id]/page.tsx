import { Suspense } from "react";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Breadcrumbs } from "../../_components/Breadcrumbs";
import { HistoryTimeline } from "../../_components/HistoryTimeline";
import { TasksTable } from "../../_components/TasksTable";
import {
  getInstanceById,
  getInstanceHistory,
  getTasksForInstance,
} from "../../_data/workflowData";

export const dynamic = "force-dynamic";

export default async function InstanceDetailPage({ params }: { params: { id: string } }) {
  const [{ data: instance, source }, { data: history }, { data: tasks }] = await Promise.all([
    getInstanceById(params.id),
    getInstanceHistory(params.id),
    getTasksForInstance(params.id),
  ]);

  if (!instance) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Workflow", href: "/workflow" },
            { label: "Instances", href: "/workflow/list" },
            { label: "Not found" },
          ]}
        />
        <PageHeader title="Instance" back="/workflow/list" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
        <EmptyState
          icon="🧩"
          title={source === "error" ? "Could not load instance" : "Instance not found"}
          message={
            source === "error"
              ? "The workflow service did not return this instance. Check that you are signed in and the service is reachable."
              : "This instance may have been removed or the ID is invalid."
          }
        />
      </>
    );
  }

  const openTasks = tasks.filter((t) => t.status === "pending");
  const latest = [...history].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  const currentStep = latest?.toNode ?? "—";

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Workflow", href: "/workflow" },
          { label: "Instances", href: "/workflow/list" },
          { label: instance.name },
        ]}
      />
      <PageHeader
        title={instance.name}
        subtitle={
          instance.definitionName
            ? `${instance.definitionName} · version ${instance.version}`
            : `Process instance · version ${instance.version}`
        }
        back="/workflow/list"
        actions={
          <>
            <StatusPill status={instance.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📍" iconBg="#eef2ff" label="Current step" value={currentStep} />
        <StatCard icon="📋" iconBg="#fef9c3" label="Open tasks" value={openTasks.length} />
        <StatCard icon="🕘" iconBg="#f5f3ff" label="Transitions" value={history.length} />
        <StatCard icon="#️⃣" iconBg="#ecfdf5" label="Version" value={instance.version} />
      </StatGrid>

      {instance.refType ? (
        <div className="pad" style={{ paddingTop: 0 }}>
          <span style={{ color: "var(--civitas-color-text-muted)", fontSize: 13 }}>
            Linked to {instance.refType}
            {instance.refId ? ` · ${instance.refId}` : ""}
          </span>
        </div>
      ) : null}

      <div className="grid g-2" style={{ marginTop: 18 }}>
        <Card title="Open tasks">
          {openTasks.length === 0 ? (
            <div className="pad">
              <EmptyState icon="✅" title="No open tasks" message="There are no pending tasks on this instance." />
            </div>
          ) : (
            <div className="pad">
              <Suspense fallback={null}>
                <TasksTable tasks={openTasks} showInstance={false} />
              </Suspense>
            </div>
          )}
        </Card>

        <Card title="Transition history" padding>
          {history.length === 0 ? (
            <EmptyState
              icon="🕘"
              title="No history"
              message="State changes for this instance will appear here as it progresses."
            />
          ) : (
            <HistoryTimeline transitions={history} />
          )}
        </Card>
      </div>
    </>
  );
}
