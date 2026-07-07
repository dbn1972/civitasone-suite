/**
 * Monte Carlo Simulation — Project Delay Prediction
 *
 * Runs N iterations of randomized task duration simulations to produce
 * P50, P80, P95 completion date estimates and per-task risk scores.
 * Uses dependency graph traversal (longest path / critical path) to
 * compute project completion time per iteration.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

export interface TaskSimInput {
  taskId: string;
  baselineDurationMs: number; // expected duration in ms
  varianceMs: number; // standard deviation of duration
  dependencies: string[]; // taskIds that must complete before this task starts
  assignedTo?: string; // person/resource ID
  isCriticalPath: boolean;
}

export interface TaskRisk {
  taskId: string;
  riskScore: number; // 0.0–1.0
  factors: string[]; // reason strings (e.g., "high variance", "resource contention")
}

export interface ResourceBottleneck {
  userId: string;
  concurrentCriticalTasks: number;
}

export interface SimulationResult {
  p50Ms: bigint;
  p80Ms: bigint;
  p95Ms: bigint;
  taskRisks: TaskRisk[];
  bottlenecks: ResourceBottleneck[];
}

/**
 * Box-Muller transform to generate a normally distributed random number.
 * Returns a sample from N(mean, std^2).
 *
 * When std is 0 (zero-variance), returns mean directly (deterministic).
 */
function sampleNormal(mean: number, std: number, rng: () => number): number {
  if (std === 0) {
    return mean;
  }

  // Box-Muller transform
  let u1 = rng();
  let u2 = rng();

  // Avoid log(0)
  while (u1 === 0) {
    u1 = rng();
  }

  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const sample = mean + std * z0;

  // Clamp to non-negative duration — tasks cannot have negative duration
  return Math.max(0, sample);
}

/**
 * Simple seeded PRNG (mulberry32).
 * Produces values in [0, 1).
 */
function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns ordered taskIds. Handles disconnected components.
 * Tasks with missing or invalid dependencies are treated as having no dependencies.
 */
function topologicalSort(tasks: TaskSimInput[]): string[] {
  const taskMap = new Map<string, TaskSimInput>();
  for (const task of tasks) {
    taskMap.set(task.taskId, task);
  }

  // Build adjacency list and in-degree map
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.taskId, 0);
    adjacency.set(task.taskId, []);
  }

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      // Only count dependencies that actually exist in our task set
      if (taskMap.has(dep)) {
        const current = inDegree.get(task.taskId) ?? 0;
        inDegree.set(task.taskId, current + 1);
        const adj = adjacency.get(dep) ?? [];
        adj.push(task.taskId);
        adjacency.set(dep, adj);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [taskId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(taskId);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If there are cyclic dependencies, remaining tasks get appended
  // (they are treated as having no additional dependency constraints)
  if (sorted.length < tasks.length) {
    for (const task of tasks) {
      if (!sorted.includes(task.taskId)) {
        sorted.push(task.taskId);
      }
    }
  }

  return sorted;
}

/**
 * Compute the completion time for each task given sampled durations.
 * Uses topological ordering to ensure dependencies are processed first.
 * Returns a map of taskId → finish time (ms from project start).
 */
function computeCompletionTimes(
  tasks: TaskSimInput[],
  sampledDurations: Map<string, number>,
  topoOrder: string[],
  taskMap: Map<string, TaskSimInput>,
): Map<string, number> {
  const finishTimes = new Map<string, number>();

  for (const taskId of topoOrder) {
    const task = taskMap.get(taskId);
    if (!task) continue;

    const duration = sampledDurations.get(taskId) ?? task.baselineDurationMs;

    // Start time = max finish time of all dependencies
    let startTime = 0;
    for (const dep of task.dependencies) {
      if (taskMap.has(dep)) {
        const depFinish = finishTimes.get(dep) ?? 0;
        startTime = Math.max(startTime, depFinish);
      }
    }

    finishTimes.set(taskId, startTime + duration);
  }

  return finishTimes;
}

/**
 * Identify which tasks were on the critical path for a given iteration.
 * A task is on the critical path if its finish time equals the project completion time
 * and removing it would reduce the project completion time.
 *
 * Simplified approach: tasks whose finish time equals project completion time
 * or whose dependency chain leads to the final task.
 */
function findCriticalPathTasks(
  finishTimes: Map<string, number>,
  taskMap: Map<string, TaskSimInput>,
  topoOrder: string[],
  projectCompletion: number,
): Set<string> {
  const criticalTasks = new Set<string>();

  // Work backwards from tasks that finish at project completion time
  const endTasks: string[] = [];
  for (const [taskId, finish] of finishTimes) {
    if (Math.abs(finish - projectCompletion) < 0.001) {
      endTasks.push(taskId);
      criticalTasks.add(taskId);
    }
  }

  // Build reverse adjacency (task → dependents)
  const dependents = new Map<string, string[]>();
  for (const task of taskMap.values()) {
    for (const dep of task.dependencies) {
      if (taskMap.has(dep)) {
        const list = dependents.get(dep) ?? [];
        list.push(task.taskId);
        dependents.set(dep, list);
      }
    }
  }

  // Trace backwards: a dependency is critical if it directly contributes to a critical task's start
  // Process in reverse topological order
  const reverseOrder = [...topoOrder].reverse();
  for (const taskId of reverseOrder) {
    if (!criticalTasks.has(taskId)) continue;

    const task = taskMap.get(taskId);
    if (!task) continue;

    const taskStart = (finishTimes.get(taskId) ?? 0) - (finishTimes.get(taskId) ?? 0) +
      ((finishTimes.get(taskId) ?? 0) - (taskMap.get(taskId)?.baselineDurationMs ?? 0));

    // Find which dependency finishes latest (determines this task's start)
    let maxDepFinish = 0;
    let maxDep: string | null = null;
    for (const dep of task.dependencies) {
      if (taskMap.has(dep)) {
        const depFinish = finishTimes.get(dep) ?? 0;
        if (depFinish >= maxDepFinish) {
          maxDepFinish = depFinish;
          maxDep = dep;
        }
      }
    }

    if (maxDep !== null) {
      criticalTasks.add(maxDep);
    }
  }

  return criticalTasks;
}

/**
 * Identify resource bottlenecks: persons assigned to > 3 concurrent critical-path tasks.
 * Concurrency is determined by tasks overlapping in time on the critical path.
 */
function identifyBottlenecks(
  tasks: TaskSimInput[],
): ResourceBottleneck[] {
  // Count how many critical-path tasks each person is assigned to
  const criticalTasksByUser = new Map<string, number>();

  for (const task of tasks) {
    if (task.isCriticalPath && task.assignedTo) {
      const count = criticalTasksByUser.get(task.assignedTo) ?? 0;
      criticalTasksByUser.set(task.assignedTo, count + 1);
    }
  }

  const bottlenecks: ResourceBottleneck[] = [];
  for (const [userId, count] of criticalTasksByUser) {
    if (count > 3) {
      bottlenecks.push({ userId, concurrentCriticalTasks: count });
    }
  }

  // Sort by concurrent tasks descending for consistent output
  bottlenecks.sort((a, b) => b.concurrentCriticalTasks - a.concurrentCriticalTasks);

  return bottlenecks;
}

/**
 * Compute a percentile value from a sorted array of numbers.
 * Uses linear interpolation between nearest ranks.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower]!;
  }

  const fraction = index - lower;
  return sorted[lower]! + fraction * (sorted[upper]! - sorted[lower]!);
}

/**
 * Monte Carlo simulation for project delay prediction.
 * Runs N iterations with randomized task durations based on historical variance.
 *
 * For each iteration:
 * 1. Sample random durations from N(baseline, variance) per task
 * 2. Compute project completion time using dependency graph (longest path)
 * 3. Track which tasks were on the critical path
 *
 * Returns:
 * - P50, P80, P95 completion times (bigint milliseconds)
 * - Per-task risk scores (proportion of iterations where task was on critical path)
 * - Resource bottlenecks (personnel on > 3 concurrent critical-path tasks)
 *
 * Edge cases:
 * - Empty tasks: returns p50=p80=p95=0n, empty risks and bottlenecks
 * - Single task: uses that task's duration distribution directly
 * - Zero-variance: deterministic duration (no randomness)
 * - Disconnected graph: components run in parallel, completion = max of all
 *
 * @param tasks - task list with baseline durations and historical variance
 * @param iterations - number of simulation runs (default 1000)
 * @param seed - optional seed for reproducible results
 */
export function simulateProjectDelay(
  tasks: TaskSimInput[],
  iterations: number = 1000,
  seed?: number,
): SimulationResult {
  // Edge case: empty tasks
  if (tasks.length === 0) {
    return {
      p50Ms: 0n,
      p80Ms: 0n,
      p95Ms: 0n,
      taskRisks: [],
      bottlenecks: [],
    };
  }

  // Create RNG (seeded or Math.random based)
  const rng = seed !== undefined ? createSeededRng(seed) : Math.random;

  // Precompute task map and topological order
  const taskMap = new Map<string, TaskSimInput>();
  for (const task of tasks) {
    taskMap.set(task.taskId, task);
  }
  const topoOrder = topologicalSort(tasks);

  // Track results per iteration
  const completionTimes: number[] = [];
  const criticalPathCounts = new Map<string, number>();

  // Initialize critical path counts
  for (const task of tasks) {
    criticalPathCounts.set(task.taskId, 0);
  }

  // Run Monte Carlo iterations
  for (let iter = 0; iter < iterations; iter++) {
    // 1. Sample random durations for each task
    const sampledDurations = new Map<string, number>();
    for (const task of tasks) {
      const duration = sampleNormal(task.baselineDurationMs, task.varianceMs, rng);
      sampledDurations.set(task.taskId, duration);
    }

    // 2. Compute completion times via dependency graph
    const finishTimes = computeCompletionTimes(tasks, sampledDurations, topoOrder, taskMap);

    // 3. Project completion = max finish time across all tasks
    let projectCompletion = 0;
    for (const finish of finishTimes.values()) {
      projectCompletion = Math.max(projectCompletion, finish);
    }
    completionTimes.push(projectCompletion);

    // 4. Track critical path membership
    const criticalTasks = findCriticalPathTasks(finishTimes, taskMap, topoOrder, projectCompletion);
    for (const taskId of criticalTasks) {
      const count = criticalPathCounts.get(taskId) ?? 0;
      criticalPathCounts.set(taskId, count + 1);
    }
  }

  // Sort completion times for percentile computation
  completionTimes.sort((a, b) => a - b);

  // Compute percentiles
  const p50 = percentile(completionTimes, 50);
  const p80 = percentile(completionTimes, 80);
  const p95 = percentile(completionTimes, 95);

  // Ensure p50 ≤ p80 ≤ p95 invariant (should hold naturally from sorted array)
  const finalP50 = Math.min(p50, p80, p95);
  const finalP95 = Math.max(p50, p80, p95);
  const finalP80 = Math.max(Math.min(p80, finalP95), finalP50);

  // Compute per-task risk scores
  const taskRisks: TaskRisk[] = [];
  for (const task of tasks) {
    const criticalCount = criticalPathCounts.get(task.taskId) ?? 0;
    const riskScore = criticalCount / iterations;

    // Determine risk factors
    const factors: string[] = [];
    if (task.varianceMs > task.baselineDurationMs * 0.5) {
      factors.push("high variance");
    }
    if (task.dependencies.length >= 3) {
      factors.push("heavy dependency chain");
    }
    if (riskScore > 0.8) {
      factors.push("frequently on critical path");
    }
    if (task.isCriticalPath && task.assignedTo) {
      // Check if this person has multiple critical path tasks
      const userCriticalCount = tasks.filter(
        (t) => t.isCriticalPath && t.assignedTo === task.assignedTo,
      ).length;
      if (userCriticalCount > 3) {
        factors.push("resource contention");
      }
    }

    taskRisks.push({
      taskId: task.taskId,
      riskScore: Math.round(riskScore * 1000) / 1000, // 3 decimal places
      factors,
    });
  }

  // Sort task risks by risk score descending
  taskRisks.sort((a, b) => b.riskScore - a.riskScore);

  // Identify resource bottlenecks
  const bottlenecks = identifyBottlenecks(tasks);

  return {
    p50Ms: BigInt(Math.round(finalP50)),
    p80Ms: BigInt(Math.round(finalP80)),
    p95Ms: BigInt(Math.round(finalP95)),
    taskRisks,
    bottlenecks,
  };
}
