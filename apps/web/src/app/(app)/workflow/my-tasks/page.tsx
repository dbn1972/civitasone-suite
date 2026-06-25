import { Suspense } from "react";
import { PageHeader, StatCard, StatGrid, Card, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Breadcrumbs } from "../_components/Breadcrumbs";
import { TasksTable } from "../_components/TasksTable";
import { getTasks } from "../_data/workflowData";

export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  // Role-targeted pending inbox for the caller (service scopes to ctx.roles).
  const { data: tasks, source } = await getTasks({ status: "pending" });

  const pending = tasks.filter((t) => t.status === "pending").length;
  const unassigned = tasks.filter((t) => !t.assigneeId).length;
  const assigned = tasks.filter((t) => t.assigneeId).length;

  return (
    <>
      <Breadcrumbs items={[{ label: "Workflow", href: "/workflow" }, { label: "My tasks" }]} />
      <PageHeader
        title="My tasks"
        subtitle="Your task inbox. Claim an unassigned task, then approve, return or reject it. Decisions are recorded in the immutable transition history (maker-checker)."
        back="/workflow"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="📥" iconBg="#eef2ff" label="Open tasks" value={tasks.length} />
        <StatCard icon="⏳" iconBg="#fff7ed" label="Pending" value={pending} />
        <StatCard icon="🙋" iconBg="#fffbeb" label="Unassigned" value={unassigned} />
        <StatCard icon="✋" iconBg="#ecfdf5" label="Claimed" value={assigned} />
      </StatGrid>

      <div style={{ marginTop: 18 }}>
        <Card title="Task inbox">
          {source === "error" ? (
            <div className="pad">
              <EmptyState
                icon="⚠️"
                title="Could not load tasks"
                message="The workflow service did not return your task inbox. Check that you are signed in with a workflow role and the service is reachable."
              />
            </div>
          ) : tasks.length === 0 ? (
            <div className="pad">
              <EmptyState icon="🎉" title="Inbox zero" message="You have no open tasks right now." />
            </div>
          ) : (
            <div className="pad">
              <Suspense fallback={null}>
                <TasksTable tasks={tasks} />
              </Suspense>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
