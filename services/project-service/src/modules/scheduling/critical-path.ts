/**
 * Critical Path Method (CPM) — pure domain logic.
 *
 * Computes the longest path through a project task network using forward/backward
 * pass analysis. Supports all 4 dependency types (FS, SS, FF, SF) with lag/lead.
 *
 * All durations and floats expressed in milliseconds (bigint).
 */

import type { DepType } from "./domain.js";

export interface TaskNode {
  id: string;
  duration: bigint;
  deps: Array<{ taskId: string; type: DepType; lag: bigint }>;
}

export interface CriticalPathResult {
  /** Task IDs on the critical path (zero total float), ordered from start to end */
  criticalPath: string[];
  /** Total float per task in ms (latest finish - earliest finish) */
  floats: Map<string, bigint>;
  /** Overall project duration in ms */
  projectDuration: bigint;
}

interface TaskSchedule {
  earlyStart: bigint;
  earlyFinish: bigint;
  lateStart: bigint;
  lateFinish: bigint;
  totalFloat: bigint;
}

/**
 * Computes the critical path for a set of tasks with dependencies.
 *
 * Algorithm:
 * 1. Topological sort (Kahn's algorithm)
 * 2. Forward pass: compute earliest start/finish per task
 * 3. Backward pass: compute latest start/finish per task
 * 4. Total float = lateFinish - earlyFinish
 * 5. Critical path = tasks with zero total float, in topological order
 *
 * Dependency type semantics:
 * - FS (Finish-to-Start): successor cannot start until predecessor finishes + lag
 * - SS (Start-to-Start): successor cannot start until predecessor starts + lag
 * - FF (Finish-to-Finish): successor cannot finish until predecessor finishes + lag
 * - SF (Start-to-Finish): successor cannot finish until predecessor starts + lag
 */
export function computeCriticalPath(tasks: TaskNode[]): CriticalPathResult {
  if (tasks.length === 0) {
    return { criticalPath: [], floats: new Map(), projectDuration: 0n };
  }

  if (tasks.length === 1) {
    const task = tasks[0]!;
    return {
      criticalPath: [task.id],
      floats: new Map([[task.id, 0n]]),
      projectDuration: task.duration,
    };
  }

  // Build lookup maps
  const taskMap = new Map<string, TaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  // Build adjacency: predecessors for each task (who depends on whom)
  // Also build successors for backward pass
  const successors = new Map<string, Array<{ taskId: string; type: DepType; lag: bigint }>>();
  for (const t of tasks) {
    if (!successors.has(t.id)) {
      successors.set(t.id, []);
    }
    for (const dep of t.deps) {
      if (!successors.has(dep.taskId)) {
        successors.set(dep.taskId, []);
      }
      // dep.taskId is the predecessor, t.id is the successor
      successors.get(dep.taskId)!.push({ taskId: t.id, type: dep.type, lag: dep.lag });
    }
  }

  // Topological sort using Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const t of tasks) {
    inDegree.set(t.id, t.deps.length);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    topoOrder.push(current);

    const succs = successors.get(current) ?? [];
    for (const succ of succs) {
      if (!taskMap.has(succ.taskId)) continue; // skip deps pointing outside our task set
      const newDeg = (inDegree.get(succ.taskId) ?? 0) - 1;
      inDegree.set(succ.taskId, newDeg);
      if (newDeg === 0) {
        queue.push(succ.taskId);
      }
    }
  }

  // If topological sort doesn't include all tasks, there's a cycle (shouldn't happen
  // if cycle detection ran first, but handle gracefully)
  if (topoOrder.length !== tasks.length) {
    // Return empty result for cyclic graphs
    return { criticalPath: [], floats: new Map(), projectDuration: 0n };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Forward Pass — compute earliest start (ES) and earliest finish (EF)
  // ═══════════════════════════════════════════════════════════════════════════════
  const schedule = new Map<string, TaskSchedule>();

  for (const id of topoOrder) {
    const task = taskMap.get(id)!;
    let earlyStart = 0n;

    // For each predecessor dependency, compute the earliest this task can start/finish
    for (const dep of task.deps) {
      const predTask = taskMap.get(dep.taskId);
      if (!predTask) continue;
      const predSched = schedule.get(dep.taskId);
      if (!predSched) continue;

      let constraint: bigint;
      switch (dep.type) {
        case "FS":
          // Successor starts after predecessor finishes + lag
          constraint = predSched.earlyFinish + dep.lag;
          break;
        case "SS":
          // Successor starts after predecessor starts + lag
          constraint = predSched.earlyStart + dep.lag;
          break;
        case "FF":
          // Successor finishes after predecessor finishes + lag
          // So successor start = predecessor finish + lag - successor duration
          constraint = predSched.earlyFinish + dep.lag - task.duration;
          break;
        case "SF":
          // Successor finishes after predecessor starts + lag
          // So successor start = predecessor start + lag - successor duration
          constraint = predSched.earlyStart + dep.lag - task.duration;
          break;
      }

      // ES cannot be negative (clamp to 0)
      if (constraint > earlyStart) {
        earlyStart = constraint;
      }
    }

    // Clamp earlyStart to 0 minimum (handles negative leads)
    if (earlyStart < 0n) {
      earlyStart = 0n;
    }

    const earlyFinish = earlyStart + task.duration;

    schedule.set(id, {
      earlyStart,
      earlyFinish,
      lateStart: 0n,   // will be computed in backward pass
      lateFinish: 0n,  // will be computed in backward pass
      totalFloat: 0n,  // will be computed after backward pass
    });
  }

  // Project duration = max early finish across all tasks
  let projectDuration = 0n;
  for (const sched of schedule.values()) {
    if (sched.earlyFinish > projectDuration) {
      projectDuration = sched.earlyFinish;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Backward Pass — compute latest start (LS) and latest finish (LF)
  // ═══════════════════════════════════════════════════════════════════════════════

  // Initialize all late finishes to project duration
  for (const sched of schedule.values()) {
    sched.lateFinish = projectDuration;
    sched.lateStart = projectDuration;
  }

  // Process in reverse topological order
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i]!;
    const task = taskMap.get(id)!;
    const sched = schedule.get(id)!;

    // For tasks with no successors, LF = projectDuration
    const succs = successors.get(id) ?? [];
    let lateFinish = projectDuration;

    for (const succ of succs) {
      const succTask = taskMap.get(succ.taskId);
      if (!succTask) continue;
      const succSched = schedule.get(succ.taskId);
      if (!succSched) continue;

      let constraint: bigint;
      switch (succ.type) {
        case "FS":
          // Predecessor must finish before successor starts - lag
          constraint = succSched.lateStart - succ.lag;
          break;
        case "SS":
          // Predecessor must start before successor starts - lag
          // So predecessor late finish = successor late start - lag + predecessor duration
          constraint = succSched.lateStart - succ.lag + task.duration;
          break;
        case "FF":
          // Predecessor must finish before successor finishes - lag
          constraint = succSched.lateFinish - succ.lag;
          break;
        case "SF":
          // Predecessor must start before successor finishes - lag
          // So predecessor late finish = successor late finish - lag + predecessor duration
          constraint = succSched.lateFinish - succ.lag + task.duration;
          break;
      }

      if (constraint < lateFinish) {
        lateFinish = constraint;
      }
    }

    sched.lateFinish = lateFinish;
    sched.lateStart = lateFinish - task.duration;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Compute total float and identify critical path
  // ═══════════════════════════════════════════════════════════════════════════════

  const floats = new Map<string, bigint>();
  const criticalTasks: string[] = [];

  for (const id of topoOrder) {
    const sched = schedule.get(id)!;
    const totalFloat = sched.lateFinish - sched.earlyFinish;
    sched.totalFloat = totalFloat;
    floats.set(id, totalFloat);

    if (totalFloat === 0n) {
      criticalTasks.push(id);
    }
  }

  return {
    criticalPath: criticalTasks,
    floats,
    projectDuration,
  };
}
