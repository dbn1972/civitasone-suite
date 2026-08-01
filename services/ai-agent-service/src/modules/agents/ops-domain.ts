/**
 * agents/ops-domain.ts — AG-002 agent operations console shaping. Pure functions.
 */

export type LiveStatus = "busy" | "idle" | "degraded" | "paused" | "archived";

export interface AgentOpsInput {
  id: string;
  name: string;
  status: string;
  activeOrchestrations: number;
  errorCount: number;
}

export interface AgentOpsRow extends AgentOpsInput {
  liveStatus: LiveStatus;
}

/**
 * Derive an operator-facing live status. Lifecycle status wins over activity:
 * a paused agent with in-flight orchestrations is still paused as far as the
 * console is concerned, otherwise an operator cannot tell that they succeeded
 * in pausing it. `degraded` outranks `busy` so failures are never hidden by
 * healthy traffic.
 */
export function deriveLiveStatus(input: {
  status: string;
  activeOrchestrations: number;
  errorCount: number;
}): LiveStatus {
  if (input.status === "archived") return "archived";
  if (input.status === "paused") return "paused";
  if (input.errorCount > 0) return "degraded";
  if (input.activeOrchestrations > 0) return "busy";
  return "idle";
}

export function buildAgentOpsRow(input: AgentOpsInput): AgentOpsRow {
  return { ...input, liveStatus: deriveLiveStatus(input) };
}

export interface OpsSummaryInput {
  running: number;
  completed: number;
  failed: number;
  aborted: number;
  avgHopCount: number;
  p95DurationMs: number;
}

export interface OpsSummary extends OpsSummaryInput {
  total: number;
  failureRatePct: number;
}

/**
 * Shape tenant-level orchestration counters. Averages are rounded to 2dp and
 * durations to whole milliseconds so the console never renders float noise;
 * a zero total yields a 0% failure rate rather than NaN.
 */
export function buildOpsSummary(input: OpsSummaryInput): OpsSummary {
  const safe = (n: number): number => (Number.isFinite(n) ? n : 0);
  const running = Math.max(0, Math.trunc(safe(input.running)));
  const completed = Math.max(0, Math.trunc(safe(input.completed)));
  const failed = Math.max(0, Math.trunc(safe(input.failed)));
  const aborted = Math.max(0, Math.trunc(safe(input.aborted)));
  const total = running + completed + failed + aborted;

  return {
    running,
    completed,
    failed,
    aborted,
    total,
    avgHopCount: Math.round(safe(input.avgHopCount) * 100) / 100,
    p95DurationMs: Math.round(safe(input.p95DurationMs)),
    failureRatePct: total === 0 ? 0 : Math.round((failed / total) * 10000) / 100,
  };
}
