/**
 * Pure domain functions for DAG resolution and wizard progress.
 * No side effects — no DB, no cache, no queue.
 */

export interface StepDef {
  stepKey: string;
  isRequired: boolean;
  dependsOn: string[];
}

export interface StepExec {
  stepKey: string;
  status: "pending" | "blocked" | "ready" | "in_progress" | "completed" | "failed" | "skipped";
}

/**
 * Returns step_keys whose dependencies are all completed (or skipped),
 * and that are currently blocked or pending.
 */
export function resolveReadySteps(definitions: StepDef[], executions: StepExec[]): string[] {
  const statusMap = new Map<string, StepExec["status"]>();
  for (const exec of executions) {
    statusMap.set(exec.stepKey, exec.status);
  }

  const satisfiedStatuses = new Set<StepExec["status"]>(["completed", "skipped"]);

  return definitions
    .filter((def) => {
      const current = statusMap.get(def.stepKey);
      if (!current || !["pending", "blocked"].includes(current)) return false;
      return def.dependsOn.every((dep) => satisfiedStatuses.has(statusMap.get(dep)!));
    })
    .map((def) => def.stepKey);
}

/**
 * A wizard is complete when every required step is completed or skipped,
 * and no steps are still in_progress.
 */
export function isWizardComplete(definitions: StepDef[], executions: StepExec[]): boolean {
  const statusMap = new Map<string, StepExec["status"]>();
  for (const exec of executions) {
    statusMap.set(exec.stepKey, exec.status);
  }

  return definitions.every((def) => {
    const status = statusMap.get(def.stepKey);
    if (!def.isRequired) return true;
    return status === "completed" || status === "skipped";
  });
}

/**
 * Returns progress counts for the wizard.
 */
export function getWizardProgress(
  definitions: StepDef[],
  executions: StepExec[],
): { total: number; completed: number; percentage: number } {
  const total = definitions.length;
  const statusMap = new Map<string, StepExec["status"]>();
  for (const exec of executions) {
    statusMap.set(exec.stepKey, exec.status);
  }

  const completed = definitions.filter((def) => {
    const status = statusMap.get(def.stepKey);
    return status === "completed" || status === "skipped";
  }).length;

  const percentage = total === 0 ? 100 : Math.round((completed / total) * 100);
  return { total, completed, percentage };
}

/**
 * Detects circular dependencies in step definitions.
 * Returns array of step_keys involved in cycles (empty if no cycles).
 */
export function detectCircularDependencies(definitions: StepDef[]): string[] {
  const graph = new Map<string, string[]>();
  for (const def of definitions) {
    graph.set(def.stepKey, def.dependsOn);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycleNodes = new Set<string>();

  function dfs(node: string): boolean {
    if (inStack.has(node)) {
      cycleNodes.add(node);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    inStack.add(node);

    const deps = graph.get(node) ?? [];
    for (const dep of deps) {
      if (dfs(dep)) {
        cycleNodes.add(node);
      }
    }

    inStack.delete(node);
    return false;
  }

  for (const def of definitions) {
    dfs(def.stepKey);
  }

  return Array.from(cycleNodes);
}

/**
 * Compute initial execution status for a step based on its dependencies.
 */
export function computeInitialStatus(def: StepDef): "ready" | "blocked" {
  return def.dependsOn.length === 0 ? "ready" : "blocked";
}
