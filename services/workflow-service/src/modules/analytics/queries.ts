import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";

/**
 * P0-3 — read-only workflow analytics / SLA reporting. Aggregates over
 * workflow.instances, workflow.tasks and workflow.transition_history. All
 * queries are tenant-scoped (parameterized) and read-only.
 */

export interface AnalyticsSummary {
  instancesByStatus: Record<string, number>;
  totalInstances: number;
  avgCycleTimeSeconds: number | null;
  completedCount: number;
  slaBreachRate: number; // fraction of resolved tasks that breached SLA (0..1)
  slaBreachedTasks: number;
  slaTrackedTasks: number;
  escalations: number;
}

export async function summary(tenantId: string): Promise<AnalyticsSummary> {
  // instances grouped by status
  const statusRows = (await db.execute(sql`
    SELECT status, COUNT(*)::int AS count
    FROM workflow.instances
    WHERE tenant_id = ${tenantId}
    GROUP BY status
  `)) as unknown as Array<{ status: string; count: number }>;

  const instancesByStatus: Record<string, number> = {};
  let totalInstances = 0;
  for (const r of statusRows) {
    instancesByStatus[r.status] = Number(r.count);
    totalInstances += Number(r.count);
  }

  // avg cycle time for completed instances (updated_at - created_at)
  const cycleRows = (await db.execute(sql`
    SELECT
      AVG(EXTRACT(EPOCH FROM (updated_at - created_at)))::float8 AS avg_seconds,
      COUNT(*)::int AS completed_count
    FROM workflow.instances
    WHERE tenant_id = ${tenantId} AND status = 'completed'
  `)) as unknown as Array<{ avg_seconds: number | null; completed_count: number }>;
  const avgCycleTimeSeconds = cycleRows[0]?.avg_seconds ?? null;
  const completedCount = Number(cycleRows[0]?.completed_count ?? 0);

  // SLA breach: among resolved (completed) tasks that had a due_at, how many
  // were completed after their due date. Breach is measured via the task's
  // completion transition timestamp in transition_history.
  const slaRows = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE t.due_at IS NOT NULL)::int AS tracked,
      COUNT(*) FILTER (WHERE t.due_at IS NOT NULL AND t.updated_at > t.due_at)::int AS breached
    FROM workflow.tasks t
    WHERE t.tenant_id = ${tenantId} AND t.status = 'completed'
  `)) as unknown as Array<{ tracked: number; breached: number }>;
  const slaTrackedTasks = Number(slaRows[0]?.tracked ?? 0);
  const slaBreachedTasks = Number(slaRows[0]?.breached ?? 0);
  const slaBreachRate = slaTrackedTasks > 0 ? slaBreachedTasks / slaTrackedTasks : 0;

  // escalations: total escalation events across tasks
  const escRows = (await db.execute(sql`
    SELECT COALESCE(SUM(escalation_count), 0)::int AS escalations
    FROM workflow.tasks
    WHERE tenant_id = ${tenantId}
  `)) as unknown as Array<{ escalations: number }>;
  const escalations = Number(escRows[0]?.escalations ?? 0);

  return {
    instancesByStatus,
    totalInstances,
    avgCycleTimeSeconds,
    completedCount,
    slaBreachRate,
    slaBreachedTasks,
    slaTrackedTasks,
    escalations,
  };
}

export interface NodeBottleneck {
  nodeKey: string | null;
  avgDwellSeconds: number | null;
  completedTasks: number;
  pendingTasks: number;
}

export interface RolePending {
  roleRef: string | null;
  pendingTasks: number;
}

export interface BottlenecksReport {
  nodes: NodeBottleneck[];
  pendingByRole: RolePending[];
}

export async function bottlenecks(tenantId: string): Promise<BottlenecksReport> {
  // avg dwell time per node: for completed tasks, time from task creation to
  // completion (updated_at - created_at), grouped by node_key. Also surface
  // current pending count per node.
  const nodeRows = (await db.execute(sql`
    SELECT
      node_key,
      AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) FILTER (WHERE status = 'completed')::float8 AS avg_dwell_seconds,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_tasks,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_tasks
    FROM workflow.tasks
    WHERE tenant_id = ${tenantId}
    GROUP BY node_key
    ORDER BY avg_dwell_seconds DESC NULLS LAST
  `)) as unknown as Array<{
    node_key: string | null;
    avg_dwell_seconds: number | null;
    completed_tasks: number;
    pending_tasks: number;
  }>;

  const nodes: NodeBottleneck[] = nodeRows.map((r) => ({
    nodeKey: r.node_key,
    avgDwellSeconds: r.avg_dwell_seconds ?? null,
    completedTasks: Number(r.completed_tasks),
    pendingTasks: Number(r.pending_tasks),
  }));

  const roleRows = (await db.execute(sql`
    SELECT role_ref, COUNT(*)::int AS pending_tasks
    FROM workflow.tasks
    WHERE tenant_id = ${tenantId} AND status = 'pending'
    GROUP BY role_ref
    ORDER BY pending_tasks DESC
  `)) as unknown as Array<{ role_ref: string | null; pending_tasks: number }>;

  const pendingByRole: RolePending[] = roleRows.map((r) => ({
    roleRef: r.role_ref,
    pendingTasks: Number(r.pending_tasks),
  }));

  return { nodes, pendingByRole };
}
