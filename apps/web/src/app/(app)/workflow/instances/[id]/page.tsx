import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import { HistoryTimeline } from "../../_components/HistoryTimeline";
import { TasksTable } from "../../_components/TasksTable";
import {
  getInstanceById,
  getInstanceHistory,
  getTasksForInstance,
  titleCase,
} from "../../_data/workflowData";

export const dynamic = "force-dynamic";

export default async function InstanceDetailPage({ params }: { params: { id: string } }) {
  const [
    { data: instance, source, status },
    { data: history, source: historySource },
    { data: tasks, source: tasksSource },
  ] = await Promise.all([
    getInstanceById(params.id),
    getInstanceHistory(params.id),
    getTasksForInstance(params.id),
  ]);

  // GAP-WORKFLOW-INSTANCES-DETAIL-06 — a 404 (incl. an invalid id the loader
  // maps to 404) is a genuine not-found, not a transient load failure.
  if (!instance && status === 404) {
    notFound();
  }

  if (!instance) {
    return (
      <>
        <PageHeader title="Instance" back="/workflow/list" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
        <Card>
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "instance" })} backHref="/workflow/list" />
          </div>
        </Card>
      </>
    );
  }

  const openTasks = tasks.filter((t) => t.status === "pending");
  const latest = [...history].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  // GAP-WORKFLOW-INSTANCES-DETAIL-03 — prefer the instance's own currentNode;
  // only fall back to the newest history row when history actually loaded, so a
  // failed history fetch does not blank out a step the instance really has.
  const currentStepKey =
    instance.currentNode ?? (historySource === "error" ? null : latest?.toNode ?? null);
  const currentStep = currentStepKey ? titleCase(currentStepKey) : null;

  return (
    <>
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
        <StatCard icon="📋" iconBg="#fef9c3" label="Open tasks" value={tasksSource === "error" ? null : openTasks.length} />
        <StatCard icon="🕘" iconBg="#f5f3ff" label="Transitions" value={historySource === "error" ? null : history.length} />
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
          {tasksSource === "error" ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "open tasks" })} />
            </div>
          ) : openTasks.length === 0 ? (
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
          {historySource === "error" ? (
            <RefreshErrorState error={toHumanError("load", { area: "transition history" })} />
          ) : history.length === 0 ? (
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
