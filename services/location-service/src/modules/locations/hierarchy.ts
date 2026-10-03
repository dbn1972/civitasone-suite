import type { LocationView } from "./schema.js";

/** Hard bound on tree depth walked in either direction (guards a parentId cycle in bad data). */
const MAX_DEPTH = 32;

export type LocationHierarchy = {
  location: LocationView;
  /** Root first, immediate parent last. Empty for a top-level location. */
  ancestors: LocationView[];
  /** Direct children, sorted by name then id. */
  children: LocationView[];
  /** Ids of every descendant (children, grandchildren, ...), excluding the location itself. */
  descendantIds: string[];
};

/**
 * Pure assembly of a locations hierarchy from the tenants flat location list.
 * Cycle-safe: a visited-set stops a parentId loop in bad data, and depth is bounded.
 * Returns null when the id is not in `rows` (callers pass a tenant-scoped list).
 */
export function buildLocationHierarchy(rows: LocationView[], id: string): LocationHierarchy | null {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const location = byId.get(id);
  if (!location) return null;

  const ancestors: LocationView[] = [];
  const seen = new Set<string>([id]);
  let cursor = location.parentId ? byId.get(location.parentId) : undefined;
  while (cursor && !seen.has(cursor.id) && ancestors.length < MAX_DEPTH) {
    ancestors.unshift(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const childrenOf = new Map<string, LocationView[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = childrenOf.get(r.parentId);
    if (list) list.push(r);
    else childrenOf.set(r.parentId, [r]);
  }
  const byNameThenId = (a: LocationView, b: LocationView) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  const children = (childrenOf.get(id) ?? []).slice().sort(byNameThenId);

  const descendantIds: string[] = [];
  const visited = new Set<string>([id]);
  let frontier = children.map((c) => c.id);
  for (let depth = 0; frontier.length > 0 && depth < MAX_DEPTH; depth++) {
    const next: string[] = [];
    for (const childId of frontier) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      descendantIds.push(childId);
      for (const g of childrenOf.get(childId) ?? []) next.push(g.id);
    }
    frontier = next;
  }

  return { location, ancestors, children, descendantIds };
}
