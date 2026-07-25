/**
 * CAP-030 — Version simulation comparison (pure domain).
 *
 * Runs the process simulator over two definition versions with the SAME inputs
 * (instance count + context variants) and reports how routing behaviour differs:
 * average-steps delta, parallel-probability delta, and per-path count changes.
 * Lets an operator see the behavioural impact of a version before publishing.
 */
import { simulateProcess, type SimulationInput, type SimulationResult } from "./domain.js";

export interface CompareInput {
  from: Pick<SimulationInput, "nodes" | "edges">;
  to: Pick<SimulationInput, "nodes" | "edges">;
  instances: number;
  contextVariants?: Array<Record<string, unknown>> | undefined;
}

export interface PathDelta {
  path: string[];
  fromPct: number;
  toPct: number;
  deltaPct: number;
}

export interface CompareResult {
  from: SimulationResult;
  to: SimulationResult;
  avgStepsDelta: number;
  avgEstimatedMinutesDelta: number | null;
  parallelBranchProbabilityDelta: number;
  pathDeltas: PathDelta[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function compareVersions(input: CompareInput): CompareResult {
  const common = {
    instances: input.instances,
    ...(input.contextVariants !== undefined ? { contextVariants: input.contextVariants } : {}),
  };
  const from = simulateProcess({ nodes: input.from.nodes, edges: input.from.edges, ...common });
  const to = simulateProcess({ nodes: input.to.nodes, edges: input.to.edges, ...common });

  const fromPct = new Map(from.pathDistribution.map((p) => [p.path.join(" → "), p.pct]));
  const toPct = new Map(to.pathDistribution.map((p) => [p.path.join(" → "), p.pct]));
  const keys = new Set<string>([...fromPct.keys(), ...toPct.keys()]);

  const pathDeltas: PathDelta[] = [];
  for (const k of keys) {
    const f = fromPct.get(k) ?? 0;
    const t = toPct.get(k) ?? 0;
    pathDeltas.push({ path: k.split(" → "), fromPct: f, toPct: t, deltaPct: round2(t - f) });
  }
  pathDeltas.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  const minutesDelta =
    from.avgEstimatedMinutes !== null && to.avgEstimatedMinutes !== null
      ? round2(to.avgEstimatedMinutes - from.avgEstimatedMinutes)
      : null;

  return {
    from,
    to,
    avgStepsDelta: round2(to.avgSteps - from.avgSteps),
    avgEstimatedMinutesDelta: minutesDelta,
    parallelBranchProbabilityDelta: round2(to.parallelBranchProbability - from.parallelBranchProbability),
    pathDeltas,
  };
}
