/**
 * agents/orchestration-domain.ts — AG-001 multi-agent orchestration safety valve.
 * Pure functions only: no IO, no network, no LLM calls.
 */

export type OrchestrationStatus = "running" | "completed" | "failed" | "aborted";

export const ORCHESTRATION_STATUSES: readonly OrchestrationStatus[] = [
  "running",
  "completed",
  "failed",
  "aborted",
];

/** Terminal states are terminal: an orchestration is never resurrected. */
const TRANSITIONS: Record<OrchestrationStatus, readonly OrchestrationStatus[]> = {
  running: ["completed", "failed", "aborted"],
  completed: [],
  failed: [],
  aborted: [],
};

export const DEFAULT_MAX_DEPTH = 5;
export const DEFAULT_MAX_HOPS = 20;

export type HandoffRefusalCode =
  | "DEPTH_LIMIT_EXCEEDED"
  | "HOP_LIMIT_EXCEEDED"
  | "ORCHESTRATION_NOT_RUNNING"
  | "LIMITS_INVALID";

export interface OrchestrationState {
  status: string;
  depth: number;
  hopCount: number;
}

export interface HandoffDecision {
  allowed: boolean;
  reason: string;
  /** Set only when `allowed` is false, so routes can map to a stable 422 code. */
  code: HandoffRefusalCode | null;
  /** Depth/hop counters the orchestration would hold if the handoff proceeds. */
  nextDepth: number;
  nextHopCount: number;
}

/**
 * Decide whether one more agent-to-agent handoff may be recorded.
 *
 * WHY BOTH LIMITS: depth alone does not stop recursion. Two agents that hand
 * work back and forth (A → B → A → B …) sit at a constant depth forever, so a
 * depth-only guard never trips and the orchestration burns tokens until a
 * timeout kills it. Conversely a hop budget alone lets a single runaway chain
 * nest arbitrarily deep before it is spotted, which makes the trace unreadable
 * and blows the context window. Depth bounds the *shape* of the delegation tree;
 * hop count bounds the *total work* across all branches. Both are checked here,
 * before anything is persisted, so an out-of-budget orchestration cannot record
 * the hop that would have taken it over the line.
 *
 * The check is intentionally conservative (`>` against the incremented value):
 * maxDepth = 5 means at most 5 levels of delegation, maxHops = 20 at most 20
 * handoffs in total.
 */
export function canHandoff(
  state: OrchestrationState,
  maxDepth: number,
  maxHops: number,
): HandoffDecision {
  const nextDepth = state.depth + 1;
  const nextHopCount = state.hopCount + 1;

  // A non-positive or non-finite budget is a misconfiguration, not "unlimited":
  // failing closed here is what keeps the valve a valve.
  if (!Number.isFinite(maxDepth) || !Number.isFinite(maxHops) || maxDepth < 1 || maxHops < 1) {
    return {
      allowed: false,
      reason: "orchestration limits must be positive integers",
      code: "LIMITS_INVALID",
      nextDepth,
      nextHopCount,
    };
  }

  if (state.status !== "running") {
    return {
      allowed: false,
      reason: `orchestration is ${state.status}; only a running orchestration accepts handoffs`,
      code: "ORCHESTRATION_NOT_RUNNING",
      nextDepth,
      nextHopCount,
    };
  }

  if (nextDepth > maxDepth) {
    return {
      allowed: false,
      reason: `handoff would reach depth ${nextDepth}, exceeding maxDepth ${maxDepth}`,
      code: "DEPTH_LIMIT_EXCEEDED",
      nextDepth,
      nextHopCount,
    };
  }

  if (nextHopCount > maxHops) {
    return {
      allowed: false,
      reason: `handoff would be hop ${nextHopCount}, exceeding maxHops ${maxHops}`,
      code: "HOP_LIMIT_EXCEEDED",
      nextDepth,
      nextHopCount,
    };
  }

  return { allowed: true, reason: "within depth and hop budget", code: null, nextDepth, nextHopCount };
}

/** Returns null when the transition is legal, else an error message. */
export function validateOrchestrationTransition(from: string, to: string): string | null {
  if (!ORCHESTRATION_STATUSES.includes(from as OrchestrationStatus)) {
    return `unknown orchestration status: ${from}`;
  }
  if (!ORCHESTRATION_STATUSES.includes(to as OrchestrationStatus)) {
    return `unknown orchestration status: ${to}`;
  }
  const allowed = TRANSITIONS[from as OrchestrationStatus];
  if (!allowed.includes(to as OrchestrationStatus)) {
    return `cannot transition orchestration from ${from} to ${to}`;
  }
  return null;
}

/** Clamp caller-supplied limits into a sane band so one request cannot ask for an unbounded run. */
export function normalizeLimits(
  maxDepth: number | undefined,
  maxHops: number | undefined,
): { maxDepth: number; maxHops: number } {
  const depth = Number.isFinite(maxDepth) ? Math.floor(maxDepth as number) : DEFAULT_MAX_DEPTH;
  const hops = Number.isFinite(maxHops) ? Math.floor(maxHops as number) : DEFAULT_MAX_HOPS;
  return {
    maxDepth: Math.min(Math.max(depth, 1), 20),
    maxHops: Math.min(Math.max(hops, 1), 200),
  };
}

export interface HopTraceEntry {
  depth: number;
  fromAgentId: string;
  toAgentId: string;
}

export interface HopTraceSummary {
  hopCount: number;
  maxDepthReached: number;
  distinctAgents: number;
  /** True when any ordered agent pair appears more than once — a delegation cycle. */
  cyclic: boolean;
}

/** Summarise a hop trace for the ops console. Empty trace ⇒ all zeros, not cyclic. */
export function summarizeHopTrace(hops: HopTraceEntry[]): HopTraceSummary {
  const agents = new Set<string>();
  const pairs = new Set<string>();
  let maxDepthReached = 0;
  let cyclic = false;

  for (const hop of hops) {
    agents.add(hop.fromAgentId);
    agents.add(hop.toAgentId);
    if (hop.depth > maxDepthReached) maxDepthReached = hop.depth;
    const key = `${hop.fromAgentId}->${hop.toAgentId}`;
    if (pairs.has(key)) cyclic = true;
    pairs.add(key);
  }

  return { hopCount: hops.length, maxDepthReached, distinctAgents: agents.size, cyclic };
}
