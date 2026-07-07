/**
 * Project Delay Forecast — Domain Logic
 *
 * Pure functions for:
 * - Fallback schedule computation (baseline dates when < 5 completed tasks)
 * - Per-task risk score computation based on SPI history, resource utilization, dependency chain
 * - Bottleneck identification (> 3 concurrent critical-path tasks per person)
 * - Conversion from simulation milliseconds to ISO date strings
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

// ── Types ─────────────────────────────────────────────────────────

export interface TaskData {
  taskId: string;
  baselineDurationMs: number;
  varianceMs: number;
  dependencies: string[];
  assignedTo?: string;
  isCriticalPath: boolean;
  /** Schedule Performance Index history (last 5 data points) — ratio of earned vs planned value */
  spiHistory: number[];
  /** Resource utilization ratio 0.0–1.0 */
  resourceUtilization: number;
  /** Whether this task is currently completed */
  isCompleted: boolean;
  /** Baseline scheduled end date (ISO) */
  baselineEndDate?: string;
}

export interface TaskRiskOutput {
  taskId: string;
  riskScore: number;
  factors: string[];
}

export interface ResourceBottleneck {
  userId: string;
  concurrentCriticalTasks: number;
}

export interface DelayForecastResult {
  p50Date: string;
  p80Date: string;
  p95Date: string;
  taskRisks: TaskRiskOutput[];
  bottlenecks: ResourceBottleneck[];
  isFallback: boolean;
}

// ── Constants ─────────────────────────────────────────────────────

/** Minimum completed tasks required for ML prediction (below this → fallback) */
export const MIN_COMPLETED_TASKS = 5;

/** Risk score threshold for emitting high-risk events */
export const HIGH_RISK_THRESHOLD = 0.80;

// ── Public Functions ──────────────────────────────────────────────

/**
 * Determine if the project has enough data for ML prediction.
 * Returns true when there are >= MIN_COMPLETED_TASKS completed tasks.
 */
export function hasEnoughHistory(tasks: TaskData[]): boolean {
  const completedCount = tasks.filter((t) => t.isCompleted).length;
  return completedCount >= MIN_COMPLETED_TASKS;
}

/**
 * Compute fallback forecast using baseline schedule dates.
 * Returns the maximum baseline end date for each percentile
 * (since without variance data we assume baseline is the best estimate).
 */
export function computeFallbackForecast(tasks: TaskData[]): DelayForecastResult {
  // Use the latest baseline end date as the single estimate for all percentiles
  let maxDate = new Date().toISOString();

  for (const task of tasks) {
    if (task.baselineEndDate && task.baselineEndDate > maxDate) {
      maxDate = task.baselineEndDate;
    }
  }

  return {
    p50Date: maxDate,
    p80Date: maxDate,
    p95Date: maxDate,
    taskRisks: [],
    bottlenecks: [],
    isFallback: true,
  };
}

/**
 * Compute per-task risk score (0.0–1.0) based on:
 * - SPI history (schedule performance index)
 * - Resource utilization
 * - Dependency chain depth/count
 *
 * Risk = weighted combination of:
 *   - SPI below 1.0 indicates behind schedule (weight: 0.40)
 *   - High resource utilization (weight: 0.30)
 *   - Heavy dependency chain (weight: 0.30)
 */
export function computeTaskRiskScores(tasks: TaskData[]): TaskRiskOutput[] {
  const results: TaskRiskOutput[] = [];

  for (const task of tasks) {
    if (task.isCompleted) continue; // skip completed tasks

    const factors: string[] = [];
    let riskScore = 0;

    // Factor 1: SPI history — average SPI below 1.0 indicates delay risk
    const spiRisk = computeSpiRisk(task.spiHistory);
    riskScore += spiRisk * 0.40;
    if (spiRisk > 0.5) {
      factors.push("SPI below target");
    }

    // Factor 2: Resource utilization — high utilization = less buffer
    const utilizationRisk = Math.min(task.resourceUtilization, 1.0);
    riskScore += utilizationRisk * 0.30;
    if (utilizationRisk > 0.8) {
      factors.push("high resource utilization");
    }

    // Factor 3: Dependency chain — more dependencies = more fragility
    const depRisk = computeDependencyRisk(task.dependencies.length);
    riskScore += depRisk * 0.30;
    if (task.dependencies.length >= 3) {
      factors.push("heavy dependency chain");
    }

    // Clamp to [0.0, 1.0]
    riskScore = Math.min(Math.max(riskScore, 0), 1.0);
    riskScore = Math.round(riskScore * 1000) / 1000; // 3 decimal places

    results.push({ taskId: task.taskId, riskScore, factors });
  }

  // Sort by risk descending
  results.sort((a, b) => b.riskScore - a.riskScore);
  return results;
}

/**
 * Identify resource bottlenecks: people assigned to > 3 concurrent
 * critical-path tasks.
 */
export function identifyBottlenecks(tasks: TaskData[]): ResourceBottleneck[] {
  const criticalByUser = new Map<string, number>();

  for (const task of tasks) {
    if (task.isCriticalPath && task.assignedTo && !task.isCompleted) {
      const count = criticalByUser.get(task.assignedTo) ?? 0;
      criticalByUser.set(task.assignedTo, count + 1);
    }
  }

  const bottlenecks: ResourceBottleneck[] = [];
  for (const [userId, count] of criticalByUser) {
    if (count > 3) {
      bottlenecks.push({ userId, concurrentCriticalTasks: count });
    }
  }

  bottlenecks.sort((a, b) => b.concurrentCriticalTasks - a.concurrentCriticalTasks);
  return bottlenecks;
}

/**
 * Convert simulation result milliseconds to ISO date strings,
 * relative to a start date (now by default).
 */
export function msToIsoDate(ms: number | bigint, startDate?: Date): string {
  const start = startDate ?? new Date();
  const msNum = typeof ms === "bigint" ? Number(ms) : ms;
  return new Date(start.getTime() + msNum).toISOString();
}

/**
 * Identify tasks with risk score > 0.80 (high-risk threshold).
 */
export function getHighRiskTasks(taskRisks: TaskRiskOutput[]): TaskRiskOutput[] {
  return taskRisks.filter((t) => t.riskScore > HIGH_RISK_THRESHOLD);
}

// ── Internal Helpers ──────────────────────────────────────────────

/**
 * Compute risk contribution from SPI history.
 * SPI < 1.0 means behind schedule.
 * Returns a value 0.0–1.0 where 1.0 = very high risk from SPI.
 */
function computeSpiRisk(spiHistory: number[]): number {
  if (spiHistory.length === 0) return 0.5; // no data → moderate risk

  const avgSpi = spiHistory.reduce((sum, val) => sum + val, 0) / spiHistory.length;

  // SPI = 1.0 → on schedule (0 risk), SPI = 0.0 → fully behind (1.0 risk)
  // SPI > 1.0 → ahead of schedule (0 risk)
  if (avgSpi >= 1.0) return 0;
  return Math.min(1.0, 1.0 - avgSpi);
}

/**
 * Compute risk from dependency count.
 * Returns 0.0–1.0 based on number of dependencies.
 * 0 deps = 0 risk, 5+ deps = 1.0 risk (linear scale).
 */
function computeDependencyRisk(depCount: number): number {
  return Math.min(depCount / 5, 1.0);
}
