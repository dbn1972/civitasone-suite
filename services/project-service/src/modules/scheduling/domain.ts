/**
 * Scheduling domain logic — pure functions for task dependency management.
 *
 * - Cycle detection via DFS
 * - Lag/lead bounds validation (±365 days in ms)
 * - Dependency type validation
 */

export type DepType = "FS" | "SS" | "FF" | "SF";

export const DEP_TYPES: readonly DepType[] = ["FS", "SS", "FF", "SF"] as const;

/** ±365 days expressed in milliseconds */
export const MAX_LAG_MS = 31_536_000_000n;
export const MIN_LAG_MS = -31_536_000_000n;

/** Maximum dependencies per task (as toTaskId) */
export const MAX_DEPS_PER_TASK = 50;

export interface TaskDep {
  fromTaskId: string;
  toTaskId: string;
}

/**
 * Detects cycles in a directed graph of task dependencies using DFS.
 * Returns the cycle path (array of task IDs forming the cycle) if a cycle is found,
 * or null if the graph is acyclic.
 */
export function hasCycle(deps: TaskDep[]): string[] | null {
  // Build adjacency list: fromTaskId → toTaskId[]
  const graph = new Map<string, string[]>();
  const allNodes = new Set<string>();

  for (const dep of deps) {
    allNodes.add(dep.fromTaskId);
    allNodes.add(dep.toTaskId);
    const edges = graph.get(dep.fromTaskId);
    if (edges) {
      edges.push(dep.toTaskId);
    } else {
      graph.set(dep.fromTaskId, [dep.toTaskId]);
    }
  }

  const WHITE = 0; // unvisited
  const GRAY = 1;  // visiting (in current DFS path)
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const node of allNodes) {
    color.set(node, WHITE);
  }

  // parent tracking for path reconstruction
  const parent = new Map<string, string | null>();

  for (const startNode of allNodes) {
    if (color.get(startNode) !== WHITE) continue;

    const stack: Array<{ node: string; neighborIdx: number }> = [];
    stack.push({ node: startNode, neighborIdx: 0 });
    color.set(startNode, GRAY);
    parent.set(startNode, null);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = graph.get(frame.node) ?? [];

      if (frame.neighborIdx >= neighbors.length) {
        // Done processing this node
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }

      const neighbor = neighbors[frame.neighborIdx]!;
      frame.neighborIdx++;

      const neighborColor = color.get(neighbor) ?? WHITE;

      if (neighborColor === GRAY) {
        // Cycle found — reconstruct path
        const cyclePath: string[] = [neighbor];
        for (let i = stack.length - 1; i >= 0; i--) {
          cyclePath.push(stack[i]!.node);
          if (stack[i]!.node === neighbor) break;
        }
        cyclePath.reverse();
        return cyclePath;
      }

      if (neighborColor === WHITE) {
        color.set(neighbor, GRAY);
        parent.set(neighbor, frame.node);
        stack.push({ node: neighbor, neighborIdx: 0 });
      }
    }
  }

  return null;
}

/**
 * Validates that a lag/lead value is within bounds (±365 days in ms).
 */
export function isValidLag(lagMs: bigint): boolean {
  return lagMs >= MIN_LAG_MS && lagMs <= MAX_LAG_MS;
}

/**
 * Validates the dependency type is one of the four standard types.
 */
export function isValidDepType(type: string): type is DepType {
  return DEP_TYPES.includes(type as DepType);
}
