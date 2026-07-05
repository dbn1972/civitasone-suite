/**
 * Process Simulation — walks a definition graph to predict path distribution,
 * average steps, and parallel branch probabilities. When context variants are
 * supplied, edge conditions are evaluated against each variant to produce
 * context-aware routing predictions.
 */
import { evaluateCondition } from "../../shared/condition.js";

export interface SimulationInput {
  nodes: Array<{ nodeKey: string; name: string; nodeType: string; slaMinutes?: number | null }>;
  edges: Array<{ fromNode: string; toNode: string; condition?: string | null; sortOrder?: number | null }>;
  instances: number;
  contextVariants?: Array<Record<string, unknown>> | undefined;
}

export interface SimulationResult {
  totalSimulated: number;
  pathDistribution: Array<{ path: string[]; count: number; pct: number }>;
  avgSteps: number;
  avgEstimatedMinutes: number | null;
  parallelBranchProbability: number;
  nodeHitCounts: Record<string, number>;
  bottleneckNodes: Array<{ nodeKey: string; hitCount: number; estimatedMinutes: number | null }>;
}

export function simulateProcess(input: SimulationInput): SimulationResult {
  const { nodes, edges, instances, contextVariants } = input;
  const nodeMap = new Map(nodes.map((n) => [n.nodeKey, n]));
  const edgesBySource = new Map<string, typeof edges>();
  for (const e of edges) {
    const arr = edgesBySource.get(e.fromNode) ?? [];
    arr.push(e);
    edgesBySource.set(e.fromNode, arr);
  }

  // Find start node (node with no incoming edges, or nodeType === 'start')
  const incomingNodes = new Set(edges.map((e) => e.toNode));
  const startNode = nodes.find((n) => n.nodeType === "start")
    ?? nodes.find((n) => !incomingNodes.has(n.nodeKey));
  if (!startNode) {
    return { totalSimulated: 0, pathDistribution: [], avgSteps: 0, avgEstimatedMinutes: null, parallelBranchProbability: 0, nodeHitCounts: {}, bottleneckNodes: [] };
  }

  const hasConditions = edges.some((e) => e.condition);
  const pathCounts = new Map<string, number>();
  const nodeHitCounts: Record<string, number> = {};
  let totalSteps = 0;
  let totalMinutes = 0;
  let parallelHits = 0;
  let minutesTracked = 0;

  for (let i = 0; i < instances; i++) {
    const context = contextVariants?.[i % (contextVariants.length || 1)] ?? {};
    const path: string[] = [];
    const visited = new Set<string>();
    let current: string | null = startNode.nodeKey;
    let steps = 0;
    let minutes = 0;

    while (current && steps < 200) { // safety cap
      if (visited.has(current)) break; // cycle detection
      visited.add(current);
      path.push(current);
      steps++;
      nodeHitCounts[current] = (nodeHitCounts[current] ?? 0) + 1;

      const node = nodeMap.get(current);
      if (node?.slaMinutes) {
        minutes += node.slaMinutes;
        minutesTracked++;
      }

      if (node?.nodeType === "split" || node?.nodeType === "parallel") {
        parallelHits++;
      }

      if (node?.nodeType === "end") break;

      const outgoing: SimulationInput["edges"] = edgesBySource.get(current) ?? [];
      if (outgoing.length === 0) break;

      // For split/parallel: in simulation we linearize for path counting
      if (node?.nodeType === "split" || node?.nodeType === "parallel") {
        const sorted = [...outgoing].sort((a, b) => (a.sortOrder ?? 1) - (b.sortOrder ?? 1));
        current = sorted[0]?.toNode ?? null;
      } else if (hasConditions && Object.keys(context).length > 0) {
        // Context-aware routing: evaluate edge conditions against the variant
        const sorted = [...outgoing].sort((a, b) => (a.sortOrder ?? 1) - (b.sortOrder ?? 1));
        const matched = sorted.find((e) => evaluateCondition(e.condition, context));
        // Fall back to first edge (default path) if no condition matches
        current = matched?.toNode ?? sorted[0]?.toNode ?? null;
      } else {
        // Deterministic: pick first edge by sort_order
        const sorted = [...outgoing].sort((a, b) => (a.sortOrder ?? 1) - (b.sortOrder ?? 1));
        current = sorted[0]?.toNode ?? null;
      }
    }

    totalSteps += steps;
    totalMinutes += minutes;
    const pathKey = path.join(" → ");
    pathCounts.set(pathKey, (pathCounts.get(pathKey) ?? 0) + 1);
  }

  const pathDistribution = Array.from(pathCounts.entries())
    .map(([pathStr, count]) => ({
      path: pathStr.split(" → "),
      count,
      pct: Math.round((count / instances) * 10000) / 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // top 20 paths

  const avgSteps = instances > 0 ? Math.round((totalSteps / instances) * 100) / 100 : 0;
  const avgEstimatedMinutes = minutesTracked > 0 ? Math.round((totalMinutes / instances) * 100) / 100 : null;
  const parallelBranchProbability = instances > 0 ? Math.round((parallelHits / instances) * 10000) / 100 : 0;

  const bottleneckNodes = Object.entries(nodeHitCounts)
    .map(([nodeKey, hitCount]) => ({
      nodeKey,
      hitCount,
      estimatedMinutes: nodeMap.get(nodeKey)?.slaMinutes ?? null,
    }))
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 10);

  return {
    totalSimulated: instances,
    pathDistribution,
    avgSteps,
    avgEstimatedMinutes,
    parallelBranchProbability,
    nodeHitCounts,
    bottleneckNodes,
  };
}
