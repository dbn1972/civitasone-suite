import { Suspense } from "react";
import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState, SkeletonTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { Breadcrumbs } from "../_components/Breadcrumbs";
import { TasksTable } from "../_components/TasksTable";
import { getTasks } from "../_data/workflowData";

export const dynamic = "force-dynamic";

const TASK_LIMIT = 200;

export default async function MyTasksPage() {
  // Role-targeted pending inbox for the caller (service scopes to ctx.roles).
  const { data: tasks, source } = await getTasks({ status: "pending" });
  const currentUserId = getSessionUserId();
  const ok = source !== "error";

  // GAP-WORKFLOW-MY-TASKS-03 — honest, non-redundant stats. The fetch is
  // already status=pending, so "Open" and "Pending" were the same number;
  // "Claimed" counted ANY assignee (not mine). Replace with Open / Unassigned /
  // Claimed by me, each null on error so an outage reads as "—", not zeros.
  const open = ok ? tasks.length : null;
  const unassigned = ok ? tasks.filter((t) => !t.assigneeId).length : null;
  const claimedByMe = ok
    ? currentUserId
      ? tasks.filter((t) => t.assigneeId === currentUserId).length
      : null
    : null;

  // GAP-WORKFLOW-MY-TASKS-04 — the inbox is capped at TASK_LIMIT with no total;
  // when the window is full the counts above stop being exhaustive. Say so.
  const capped = ok && tasks.length >= TASK_LIMIT;

  return (
    <>
      <Breadcrumbs items={[{ label: "Workflow", href: "/workflow" }, { label: "My tasks" }]} />
      <PageHeader
        title="My tasks"
        subtitle="Your task inbox. Claim an unassigned task, then approve, return or reject it. Decisions are recorded in the immutable transition history (maker-checker)."
        back="/workflow"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="📥" iconBg="#eef2ff" label="Open tasks" value={open} />
        <StatCard icon="🙋" iconBg="#fffbeb" label="Unassigned" value={unassigned} />
        <StatCard
          icon="✋"
          iconBg="#ecfdf5"
          label="Claimed by me"
          value={claimedByMe}
          hint={currentUserId ? undefined : "Sign in to see tasks claimed by you."}
        />
      </StatGrid>

      <div style={{ marginTop: 18 }}>
        <Card title="Task inbox">
          {source === "error" ? (
            // GAP-WORKFLOW-MY-TASKS-05 — real retry, not a dead-end warning.
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "your tasks" })} source={{ area: "tasks", status: 500 }} />
            </div>
          ) : tasks.length === 0 ? (
            <div className="pad">
              <EmptyState icon="🎉" title="Inbox zero" message="You have no open tasks right now." />
            </div>
          ) : (
            <div className="pad">
              {capped ? (
                <p className="mut" style={{ margin: "0 0 10px", fontSize: 13 }}>
                  Showing the first {TASK_LIMIT} tasks. Counts above cover this window only — act on the oldest first.
                </p>
              ) : null}
              <Suspense fallback={<SkeletonTable rows={6} />}>
                {/* GAP-WORKFLOW-MY-TASKS-03 — single-status inbox: no status filter. */}
                <TasksTable tasks={tasks} currentUserId={currentUserId} showStatusFilter={false} />
              </Suspense>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
