/**
 * Work Breakdown Structure (WBS) — pure domain logic.
 *
 * Provides:
 * - Hierarchy rollup: bottom-up aggregation of duration (sum), cost (sum in bigint paise),
 *   and weighted-average completion percentage.
 * - Delay analysis: compare actual/forecast dates against baseline, compute variance in ms.
 * - Critical-path flag: mark nodes that lie on the critical path.
 *
 * Max 10 levels of WBS depth.
 */

export const MAX_WBS_DEPTH = 10;

export interface WbsNode {
  id: string;
  parentId: string | null;
  /** Duration in milliseconds (leaf nodes have their own; parents are rolled up) */
  durationMs: bigint;
  /** Cost in bigint paise (leaf nodes have their own; parents are rolled up) */
  costPaise: bigint;
  /** Completion percentage 0–100 (leaf nodes have their own; parents are rolled up) */
  completionPct: number;
  /** Weight for weighted-average rollup. Defaults to 1 if not specified. */
  weightPct: number;
}

export interface WbsRollupResult {
  id: string;
  /** Rolled-up duration: sum of all descendant leaf durations in ms */
  durationMs: bigint;
  /** Rolled-up cost: sum of all descendant leaf costs in bigint paise */
  costPaise: bigint;
  /** Rolled-up completion: weighted average of children by weightPct */
  completionPct: number;
  /** Depth level in the hierarchy (root = 0) */
  depth: number;
}

export interface DelayAnalysisInput {
  taskId: string;
  /** Actual or forecast start date (ms since epoch) */
  actualStartMs: bigint | null;
  /** Actual or forecast end date (ms since epoch) */
  actualEndMs: bigint | null;
  /** Baseline planned start date (ms since epoch) */
  baselineStartMs: bigint;
  /** Baseline planned end date (ms since epoch) */
  baselineEndMs: bigint;
  /** Whether this task is on the critical path */
  onCriticalPath: boolean;
}

export interface DelayAnalysisResult {
  taskId: string;
  /** Start variance in milliseconds (positive = delayed) */
  startVarianceMs: bigint;
  /** End variance in milliseconds (positive = delayed) */
  endVarianceMs: bigint;
  /** Whether this task is on the critical path */
  onCriticalPath: boolean;
}

/**
 * Computes the depth of each node in the WBS hierarchy.
 * Returns null if any node exceeds MAX_WBS_DEPTH.
 */
export function computeDepths(nodes: WbsNode[]): Map<string, number> | null {
  const nodeMap = new Map<string, WbsNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const depths = new Map<string, number>();

  function getDepth(nodeId: string): number {
    if (depths.has(nodeId)) return depths.get(nodeId)!;

    const node = nodeMap.get(nodeId);
    if (!node || node.parentId === null) {
      depths.set(nodeId, 0);
      return 0;
    }

    const parentDepth = getDepth(node.parentId);
    const depth = parentDepth + 1;
    depths.set(nodeId, depth);
    return depth;
  }

  for (const node of nodes) {
    const depth = getDepth(node.id);
    if (depth >= MAX_WBS_DEPTH) {
      return null; // Exceeds max depth
    }
  }

  return depths;
}

/**
 * Performs bottom-up WBS hierarchy rollup.
 *
 * For each parent node:
 * - Duration = sum of child durations
 * - Cost = sum of child costs (bigint paise)
 * - Completion % = weighted average of child completion percentages by weightPct
 *
 * Leaf nodes retain their own values.
 * Returns rolled-up results for ALL nodes (leaves and parents).
 */
export function rollupWbs(nodes: WbsNode[]): WbsRollupResult[] | null {
  if (nodes.length === 0) return [];

  // Validate depth
  const depths = computeDepths(nodes);
  if (depths === null) return null; // exceeds max depth

  const nodeMap = new Map<string, WbsNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Build children map
  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (!childrenMap.has(node.id)) {
      childrenMap.set(node.id, []);
    }
    if (node.parentId !== null) {
      const siblings = childrenMap.get(node.parentId);
      if (siblings) {
        siblings.push(node.id);
      } else {
        childrenMap.set(node.parentId, [node.id]);
      }
    }
  }

  // Results cache
  const results = new Map<string, WbsRollupResult>();

  function computeRollup(nodeId: string): WbsRollupResult {
    if (results.has(nodeId)) return results.get(nodeId)!;

    const node = nodeMap.get(nodeId)!;
    const children = childrenMap.get(nodeId) ?? [];
    const depth = depths!.get(nodeId) ?? 0;

    // Leaf node — return its own values
    if (children.length === 0) {
      const result: WbsRollupResult = {
        id: nodeId,
        durationMs: node.durationMs,
        costPaise: node.costPaise,
        completionPct: node.completionPct,
        depth,
      };
      results.set(nodeId, result);
      return result;
    }

    // Parent node — rollup from children
    let totalDuration = 0n;
    let totalCost = 0n;
    let weightedCompletionSum = 0;
    let totalWeight = 0;

    for (const childId of children) {
      const childResult = computeRollup(childId);
      const childNode = nodeMap.get(childId)!;

      totalDuration += childResult.durationMs;
      totalCost += childResult.costPaise;

      const weight = childNode.weightPct;
      weightedCompletionSum += childResult.completionPct * weight;
      totalWeight += weight;
    }

    // Weighted average completion (avoid division by zero)
    const completionPct = totalWeight === 0
      ? 0
      : Math.round((weightedCompletionSum / totalWeight) * 100) / 100;

    const result: WbsRollupResult = {
      id: nodeId,
      durationMs: totalDuration,
      costPaise: totalCost,
      completionPct,
      depth,
    };
    results.set(nodeId, result);
    return result;
  }

  // Compute rollup for all nodes (start from roots, but memoization handles order)
  for (const node of nodes) {
    computeRollup(node.id);
  }

  return Array.from(results.values());
}

/**
 * Performs delay analysis by comparing actual/forecast dates against baseline.
 *
 * For each task:
 * - Start variance = actualStartMs - baselineStartMs (positive = delayed)
 * - End variance = actualEndMs - baselineEndMs (positive = delayed)
 *
 * Only returns tasks with a positive variance (i.e., tasks that are delayed).
 * Includes the critical-path flag for each slipped task.
 */
export function analyzeDelays(inputs: DelayAnalysisInput[]): DelayAnalysisResult[] {
  const results: DelayAnalysisResult[] = [];

  for (const input of inputs) {
    const startVarianceMs = input.actualStartMs !== null
      ? input.actualStartMs - input.baselineStartMs
      : 0n;

    const endVarianceMs = input.actualEndMs !== null
      ? input.actualEndMs - input.baselineEndMs
      : 0n;

    // Only report tasks with positive (delayed) variance
    if (startVarianceMs > 0n || endVarianceMs > 0n) {
      results.push({
        taskId: input.taskId,
        startVarianceMs: startVarianceMs > 0n ? startVarianceMs : 0n,
        endVarianceMs: endVarianceMs > 0n ? endVarianceMs : 0n,
        onCriticalPath: input.onCriticalPath,
      });
    }
  }

  return results;
}

/**
 * Validates that the WBS hierarchy does not exceed MAX_WBS_DEPTH levels.
 */
export function validateWbsDepth(nodes: WbsNode[]): boolean {
  const depths = computeDepths(nodes);
  return depths !== null;
}
