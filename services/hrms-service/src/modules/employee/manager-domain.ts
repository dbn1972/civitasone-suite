/**
 * 0230 — Cycle-detection validation on manager assignment.
 * Prevents circular reporting chains (A→B→C→A) by walking the graph.
 * Pure domain logic — no I/O.
 */

export interface ManagerGraph {
  /** Map of employeeId → managerId (null if root) */
  edges: Map<string, string | null>;
}

/**
 * Detect if assigning `managerId` to `employeeId` would create a cycle.
 * Walks up from managerId following the graph; if we arrive back at
 * employeeId, there's a cycle.
 *
 * @param graph - current reporting graph (employee → manager edges)
 * @param employeeId - the employee being reassigned
 * @param newManagerId - the proposed new manager
 * @param maxDepth - safety cap to prevent infinite loops on corrupt data (default 50)
 * @returns true if a cycle would be created
 */
export function wouldCreateCycle(
  graph: ManagerGraph,
  employeeId: string,
  newManagerId: string,
  maxDepth = 50,
): boolean {
  // Self-assignment is always a cycle
  if (employeeId === newManagerId) return true;

  // Walk up from the proposed manager — if we reach the employee, it's a cycle
  let current: string | null = newManagerId;
  let depth = 0;
  while (current !== null && depth < maxDepth) {
    if (current === employeeId) return true;
    current = graph.edges.get(current) ?? null;
    depth++;
  }
  return false;
}

/**
 * Validate all three manager fields (managerId, functionalManagerId, projectManagerId)
 * for cycles. Returns the first field that creates a cycle, or null if all are safe.
 */
export function validateManagerAssignment(
  graph: ManagerGraph,
  employeeId: string,
  managers: {
    managerId?: string | null | undefined;
    functionalManagerId?: string | null | undefined;
    projectManagerId?: string | null | undefined;
  },
): { field: string; managerId: string } | null {
  for (const [field, mgr] of Object.entries(managers)) {
    if (mgr && wouldCreateCycle(graph, employeeId, mgr)) {
      return { field, managerId: mgr };
    }
  }
  return null;
}
