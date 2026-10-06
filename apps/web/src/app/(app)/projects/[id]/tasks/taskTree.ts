// GAP-PROJECTS-DETAIL-TASKS-02: the tasks page rendered rows in raw API order
// with a flat 16px indent whenever parentTaskId was set — so a sub-task did not
// sit under its parent and only one level of nesting was ever shown. This builds
// a real parent→children tree and walks it depth-first, exposing a `depth` per
// row so the page can indent by depth*16 (any number of levels), with children
// appearing directly under their parent.

export interface TaskNodeInput {
  id: string;
  parentTaskId: string | null;
  [key: string]: unknown;
}

export type OrderedTask<T extends TaskNodeInput> = T & { depth: number };

/**
 * Order tasks depth-first so each task appears immediately after its parent,
 * annotating each with its `depth` (0 for roots). Tasks whose parentTaskId
 * does not resolve to a task in the same list are treated as roots (so an
 * orphaned sub-task is never dropped). Stable: siblings keep their input order.
 */
export function orderTaskTree<T extends TaskNodeInput>(tasks: readonly T[]): OrderedTask<T>[] {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    // An unresolved parent id makes the task a root rather than invisible.
    const key = t.parentTaskId && ids.has(t.parentTaskId) ? t.parentTaskId : null;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(t);
    else byParent.set(key, [t]);
  }

  const out: OrderedTask<T>[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number): void => {
    for (const t of byParent.get(parentId) ?? []) {
      if (seen.has(t.id)) continue; // guard against a cycle
      seen.add(t.id);
      out.push({ ...t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  // Any task caught in a cycle (never seen) is appended at depth 0 so nothing is lost.
  for (const t of tasks) if (!seen.has(t.id)) out.push({ ...t, depth: 0 });
  return out;
}
