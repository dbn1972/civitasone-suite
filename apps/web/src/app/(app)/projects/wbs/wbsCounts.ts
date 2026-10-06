// GAP-PROJECTS-WBS-02: the WBS stat tiles did not reconcile. "In Progress"
// matched only "in progress"/"in_progress" and "Not Started" only
// "pending"/"planned", so a "blocked" node (a real status the tasks page uses,
// projects/[id]/tasks/page.tsx) — or any other status — fell into NO tile,
// and the four tiles never summed to the Total count. This buckets every node
// into exactly one bucket so completed + inProgress + blocked + notStarted
// always equals total, regardless of the backend's status vocabulary or its
// word-separator style (snake_case / spaced / mixed case).
import type { ProjectWbsNode } from "@/app/_data/loaders";

export type WbsCounts = {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  /** Everything not completed / in-progress / blocked: pending, planned,
   * on-hold, and any unrecognised status — the exhaustive remainder so the
   * tiles always add up to `total`. */
  notStarted: number;
};

/** Canonical status key: lower-case, with snake_case/camelCase/hyphen word
 * boundaries collapsed to single spaces — matching StatusPill's own
 * normalisation so "in_progress" and "in progress" bucket identically. */
export function normalizeWbsStatus(status: string): string {
  return status
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function countWbsNodes(nodes: readonly ProjectWbsNode[]): WbsCounts {
  let completed = 0;
  let inProgress = 0;
  let blocked = 0;
  let notStarted = 0;

  for (const node of nodes) {
    const key = normalizeWbsStatus(node.status ?? "");
    if (key === "completed" || key === "done") {
      completed += 1;
    } else if (key === "in progress") {
      inProgress += 1;
    } else if (key === "blocked") {
      blocked += 1;
    } else {
      // pending, planned, on hold, delayed, unknown, empty — the exhaustive
      // remainder so every node is counted exactly once.
      notStarted += 1;
    }
  }

  return { total: nodes.length, completed, inProgress, blocked, notStarted };
}
