/**
 * Data access for delay-forecast (DOM-001 fix).
 *
 * Loads a project's REAL tasks and dependencies from this service's own
 * tables (`project.project_tasks`, `project.task_dependencies`) and shapes
 * them into the `TaskData[]` the Monte Carlo / local forecast logic
 * consumes.
 *
 * Before this fix, the route used a hardcoded array of 7 synthetic tasks
 * (`task-1`..`task-7`) for every project and every tenant — see the removed
 * `getProjectTasks` stub that used to live in `routes.ts`.
 *
 * This schema does not persist a per-task SPI time-series or a per-task
 * assignee/resource-utilization figure, so those two signals are honestly
 * derived from columns that DO exist (planned/actual dates, progress_pct,
 * the dependency graph) rather than invented:
 *  - `computeTaskSpi` is a single-point EV/PV-style ratio from the task's
 *    own planned window and its own reported progress_pct.
 *  - `resourceUtilization` reports 0 (no signal) and `assignedTo` is left
 *    undefined — this makes bottleneck detection legitimately return no
 *    bottlenecks rather than fabricating utilization/assignee data.
 *  - `varianceMs` for incomplete tasks is projected from THIS project's own
 *    completed-task actual-vs-planned variance ratio (0 when there isn't
 *    one yet) — never a fixed constant.
 */
import { listTasksByProject } from "../project/repo.js";
import { getProjectDepsWithLag, type DepEdgeWithLag } from "../scheduling/repo.js";
import { computeCriticalPath, type TaskNode } from "../scheduling/critical-path.js";
import type { DepType } from "../scheduling/domain.js";
import type { TaskData } from "./domain.js";

interface TaskRowLike {
  id: string;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  progressPct: string | number;
}

function toMs(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  return Number.isNaN(t) ? null : t;
}

function plannedDurationMs(plannedStart: string | null, plannedEnd: string | null): bigint {
  const start = toMs(plannedStart);
  const end = toMs(plannedEnd);
  if (start === null || end === null || end <= start) return 0n;
  return BigInt(Math.round(end - start));
}

/** Absolute |actual - planned| duration variance in ms, or null when actuals aren't recorded yet. */
function actualVarianceMs(row: TaskRowLike): number | null {
  const plannedStart = toMs(row.plannedStart);
  const plannedEnd = toMs(row.plannedEnd);
  const actualStart = toMs(row.actualStart);
  const actualEnd = toMs(row.actualEnd);
  if (plannedStart === null || plannedEnd === null || actualStart === null || actualEnd === null) return null;
  return Math.abs(actualEnd - actualStart - (plannedEnd - plannedStart));
}

/**
 * Average |actual - planned| / planned ratio across this project's own
 * completed, fully-dated tasks. Applied to incomplete tasks' own baseline
 * duration to project a realistic variance — this project's own history,
 * not a fabricated constant. Returns 0 when there's no history yet.
 */
function computeProjectVarianceRatio(rows: readonly TaskRowLike[]): number {
  let ratioSum = 0;
  let n = 0;
  for (const row of rows) {
    if (row.status !== "completed") continue;
    const plannedStart = toMs(row.plannedStart);
    const plannedEnd = toMs(row.plannedEnd);
    if (plannedStart === null || plannedEnd === null || plannedEnd <= plannedStart) continue;
    const variance = actualVarianceMs(row);
    if (variance === null) continue;
    ratioSum += variance / (plannedEnd - plannedStart);
    n += 1;
  }
  return n === 0 ? 0 : ratioSum / n;
}

/**
 * Task-level Schedule-Performance analogue (EV/PV), derived from the task's
 * own planned window and its own reported progress_pct. No per-task SPI
 * series is persisted, so a single-point ratio is returned in its place —
 * `computeSpiRisk` in domain.ts already averages over whatever length array
 * it's given.
 */
function computeTaskSpi(row: TaskRowLike): number {
  const start = toMs(row.plannedStart);
  const end = toMs(row.plannedEnd);
  if (start === null || end === null || end <= start) return 1; // no window → neutral, not fabricated risk
  const expectedPct = Math.max(0, Math.min(100, ((Date.now() - start) / (end - start)) * 100));
  if (expectedPct <= 0) return 1; // nothing due yet → on track
  const actualPct = Number(row.progressPct);
  return Math.max(0, Math.min(2, actualPct / expectedPct));
}

function buildPredecessorMap(depEdges: readonly DepEdgeWithLag[]): Map<string, Array<{ taskId: string; type: DepType; lag: bigint }>> {
  const map = new Map<string, Array<{ taskId: string; type: DepType; lag: bigint }>>();
  for (const edge of depEdges) {
    const list = map.get(edge.toTaskId) ?? [];
    list.push({ taskId: edge.fromTaskId, type: edge.depType as DepType, lag: edge.lagMs });
    map.set(edge.toTaskId, list);
  }
  return map;
}

/**
 * Load the REAL tasks for a project (tenant-scoped) and shape them into the
 * TaskData the forecast domain logic expects.
 *
 * Returns [] when the project has no tasks — callers MUST treat an empty
 * (or schedule-data-less) result as "insufficient data" and respond 422,
 * never fall back to synthetic placeholders.
 */
export async function getProjectTasks(projectId: string, tenantId: string): Promise<TaskData[]> {
  const [taskRows, depEdges] = await Promise.all([
    listTasksByProject(projectId, tenantId),
    getProjectDepsWithLag(projectId, tenantId),
  ]);

  if (taskRows.length === 0) return [];

  const predecessorsByTask = buildPredecessorMap(depEdges);

  const durationById = new Map<string, bigint>();
  for (const row of taskRows) {
    durationById.set(row.id, plannedDurationMs(row.plannedStart, row.plannedEnd));
  }

  const criticalPathNodes: TaskNode[] = taskRows.map((row) => ({
    id: row.id,
    duration: durationById.get(row.id) ?? 0n,
    deps: predecessorsByTask.get(row.id) ?? [],
  }));
  const onCriticalPath = new Set(computeCriticalPath(criticalPathNodes).criticalPath);

  const varianceRatio = computeProjectVarianceRatio(taskRows);

  return taskRows.map((row): TaskData => {
    const baselineDurationMs = Number(durationById.get(row.id) ?? 0n);
    const isCompleted = row.status === "completed";
    const measuredVariance = isCompleted ? actualVarianceMs(row) : null;
    const varianceMs = measuredVariance ?? Math.round(baselineDurationMs * varianceRatio);

    return {
      taskId: row.id,
      baselineDurationMs,
      varianceMs,
      dependencies: (predecessorsByTask.get(row.id) ?? []).map((d) => d.taskId),
      isCriticalPath: onCriticalPath.has(row.id),
      spiHistory: [computeTaskSpi(row)],
      // No per-task assignee/resource-utilization is tracked in this schema —
      // report 0 (no signal) rather than inventing a figure.
      resourceUtilization: 0,
      isCompleted,
      // exactOptionalPropertyTypes: only set the key when there's a real date.
      ...(row.plannedEnd ? { baselineEndDate: new Date(row.plannedEnd).toISOString() } : {}),
    };
  });
}
