import { sql } from "drizzle-orm";
import { scopedExecute } from "../../shared/db.js";

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
  const statusRows = (await scopedExecute(sql`
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
  const cycleRows = (await scopedExecute(sql`
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
  const slaRows = (await scopedExecute(sql`
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
  const escRows = (await scopedExecute(sql`
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
  const nodeRows = (await scopedExecute(sql`
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

  const roleRows = (await scopedExecute(sql`
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

export interface CycleTimeMetric {
  definitionCode: string | null;
  definitionName: string | null;
  avgCycleTimeSeconds: number | null;
  minCycleTimeSeconds: number | null;
  maxCycleTimeSeconds: number | null;
  completedCount: number;
}

export async function cycleTimeByDefinition(tenantId: string, limit: number): Promise<CycleTimeMetric[]> {
  const rows = (await scopedExecute(sql`
    SELECT
      d.code AS definition_code,
      d.name AS definition_name,
      AVG(EXTRACT(EPOCH FROM (i.updated_at - i.created_at)))::float8 AS avg_seconds,
      MIN(EXTRACT(EPOCH FROM (i.updated_at - i.created_at)))::float8 AS min_seconds,
      MAX(EXTRACT(EPOCH FROM (i.updated_at - i.created_at)))::float8 AS max_seconds,
      COUNT(*)::int AS completed_count
    FROM workflow.instances i
    LEFT JOIN workflow.definitions d ON d.id = i.definition_id
    WHERE i.tenant_id = ${tenantId} AND i.status = 'completed'
    GROUP BY d.code, d.name
    ORDER BY avg_seconds DESC NULLS LAST
    LIMIT ${limit}
  `)) as unknown as Array<{
    definition_code: string | null;
    definition_name: string | null;
    avg_seconds: number | null;
    min_seconds: number | null;
    max_seconds: number | null;
    completed_count: number;
  }>;

  return rows.map((r) => ({
    definitionCode: r.definition_code,
    definitionName: r.definition_name,
    avgCycleTimeSeconds: r.avg_seconds ?? null,
    minCycleTimeSeconds: r.min_seconds ?? null,
    maxCycleTimeSeconds: r.max_seconds ?? null,
    completedCount: Number(r.completed_count),
  }));
}

export interface AutomationRate {
  totalCompleted: number;
  humanCompleted: number;
  autoCompleted: number;
  automationRatePct: number;
}

export async function automationRate(tenantId: string): Promise<AutomationRate> {
  const rows = (await scopedExecute(sql`
    SELECT
      COUNT(*)::int AS total_completed,
      COUNT(*) FILTER (WHERE is_call = true OR fire_at IS NOT NULL OR sod_override = true)::int AS auto_completed
    FROM workflow.tasks
    WHERE tenant_id = ${tenantId} AND status = 'completed'
  `)) as unknown as Array<{ total_completed: number; auto_completed: number }>;

  const total = Number(rows[0]?.total_completed ?? 0);
  const auto = Number(rows[0]?.auto_completed ?? 0);
  const human = total - auto;
  return {
    totalCompleted: total,
    humanCompleted: human,
    autoCompleted: auto,
    automationRatePct: total > 0 ? Math.round((auto / total) * 10000) / 100 : 0,
  };
}

export interface SlaComplianceMetric {
  nodeKey: string | null;
  roleName: string | null;
  totalTracked: number;
  withinSla: number;
  breached: number;
  compliancePct: number;
}

export async function slaCompliance(tenantId: string, limit: number): Promise<SlaComplianceMetric[]> {
  const rows = (await scopedExecute(sql`
    SELECT
      node_key,
      role_ref,
      COUNT(*) FILTER (WHERE due_at IS NOT NULL)::int AS total_tracked,
      COUNT(*) FILTER (WHERE due_at IS NOT NULL AND updated_at <= due_at)::int AS within_sla,
      COUNT(*) FILTER (WHERE due_at IS NOT NULL AND updated_at > due_at)::int AS breached
    FROM workflow.tasks
    WHERE tenant_id = ${tenantId} AND status = 'completed'
    GROUP BY node_key, role_ref
    HAVING COUNT(*) FILTER (WHERE due_at IS NOT NULL) > 0
    ORDER BY breached DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    node_key: string | null;
    role_ref: string | null;
    total_tracked: number;
    within_sla: number;
    breached: number;
  }>;

  return rows.map((r) => ({
    nodeKey: r.node_key,
    roleName: r.role_ref,
    totalTracked: Number(r.total_tracked),
    withinSla: Number(r.within_sla),
    breached: Number(r.breached),
    compliancePct: Number(r.total_tracked) > 0 ? Math.round((Number(r.within_sla) / Number(r.total_tracked)) * 10000) / 100 : 100,
  }));
}

export interface VersionComparison {
  version: number;
  definitionId: string;
  avgCycleTimeSeconds: number | null;
  completedCount: number;
  rejectionRate: number;
  avgTasksPerInstance: number | null;
}

export async function versionComparison(tenantId: string, definitionCode: string): Promise<VersionComparison[]> {
  const rows = (await scopedExecute(sql`
    SELECT
      d.version,
      d.id AS definition_id,
      AVG(EXTRACT(EPOCH FROM (i.updated_at - i.created_at)))::float8 AS avg_cycle_seconds,
      COUNT(*)::int AS completed_count,
      COUNT(*) FILTER (WHERE i.status = 'cancelled')::int AS rejected_count
    FROM workflow.instances i
    JOIN workflow.definitions d ON d.id = i.definition_id
    WHERE i.tenant_id = ${tenantId}
      AND d.code = ${definitionCode}
      AND i.status IN ('completed', 'cancelled')
    GROUP BY d.version, d.id
    ORDER BY d.version ASC
  `)) as unknown as Array<{
    version: number;
    definition_id: string;
    avg_cycle_seconds: number | null;
    completed_count: number;
    rejected_count: number;
  }>;

  const results: VersionComparison[] = [];
  for (const r of rows) {
    const total = Number(r.completed_count) + Number(r.rejected_count);
    // avg tasks per instance for this version
    const taskRows = (await scopedExecute(sql`
      SELECT AVG(task_count)::float8 AS avg_tasks FROM (
        SELECT i.id, COUNT(t.id)::int AS task_count
        FROM workflow.instances i
        LEFT JOIN workflow.tasks t ON t.instance_id = i.id
        WHERE i.definition_id = ${r.definition_id} AND i.tenant_id = ${tenantId}
        GROUP BY i.id
      ) sub
    `)) as unknown as Array<{ avg_tasks: number | null }>;

    results.push({
      version: Number(r.version),
      definitionId: r.definition_id,
      avgCycleTimeSeconds: r.avg_cycle_seconds ?? null,
      completedCount: Number(r.completed_count),
      rejectionRate: total > 0 ? Math.round((Number(r.rejected_count) / total) * 10000) / 100 : 0,
      avgTasksPerInstance: taskRows[0]?.avg_tasks ?? null,
    });
  }
  return results;
}


export interface AssignmentRecommendation {
  userId: string;
  avgCompletionSeconds: number | null;
  approvalRate: number;
  currentLoad: number;
  score: number;
}

export async function assignmentRecommendations(tenantId: string, roleRef: string, limit: number): Promise<AssignmentRecommendation[]> {
  // Score = f(avg_completion_time, approval_rate, current_load)
  // Lower completion time, higher approval rate, lower load = better
  const rows = (await scopedExecute(sql`
    WITH user_stats AS (
      SELECT
        completed_by AS user_id,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)))::float8 AS avg_completion_seconds,
        COUNT(*) FILTER (WHERE decision = 'approve')::float8 / GREATEST(COUNT(*)::float8, 1) AS approval_rate,
        COUNT(*)::int AS total_completed
      FROM workflow.tasks
      WHERE tenant_id = ${tenantId}
        AND role_ref = ${roleRef}
        AND status = 'completed'
        AND completed_by IS NOT NULL
      GROUP BY completed_by
      HAVING COUNT(*) >= 3
    ),
    current_load AS (
      SELECT assignee_id AS user_id, COUNT(*)::int AS pending_count
      FROM workflow.tasks
      WHERE tenant_id = ${tenantId} AND status = 'pending' AND assignee_id IS NOT NULL
      GROUP BY assignee_id
    )
    SELECT
      us.user_id,
      us.avg_completion_seconds,
      us.approval_rate,
      COALESCE(cl.pending_count, 0)::int AS current_load,
      (
        us.approval_rate * 40 +
        (1.0 - LEAST(us.avg_completion_seconds / 86400.0, 1.0)) * 30 +
        (1.0 - LEAST(COALESCE(cl.pending_count, 0)::float8 / 20.0, 1.0)) * 30
      )::float8 AS score
    FROM user_stats us
    LEFT JOIN current_load cl ON cl.user_id = us.user_id
    ORDER BY score DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    user_id: string;
    avg_completion_seconds: number | null;
    approval_rate: number;
    current_load: number;
    score: number;
  }>;

  return rows.map((r) => ({
    userId: r.user_id,
    avgCompletionSeconds: r.avg_completion_seconds ?? null,
    approvalRate: Math.round(Number(r.approval_rate) * 10000) / 100,
    currentLoad: Number(r.current_load),
    score: Math.round(Number(r.score) * 100) / 100,
  }));
}
