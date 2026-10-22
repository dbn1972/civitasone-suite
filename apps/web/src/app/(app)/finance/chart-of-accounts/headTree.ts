/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02: put a flat list of heads of account into tree order (each head directly under
 * its parent, siblings by code) and say where each one sits, so the list shows a created minor/sub-minor head under the
 * major head it was created for. Pure and total: bad data (a parent that is not in the list, a parent cycle, a head that
 * is its own parent) never throws and never drops a row.
 */
export interface TreeHead {
  id?: string;
  parentId?: string | null;
  code: string;
  /** 0 = major, 1 = minor, 2 = sub-minor; only used as a hint when the parent chain cannot be followed. */
  level?: number;
}

export interface PlacedHead<T extends TreeHead> {
  head: T;
  /** 0 for a major head; 1 and 2 are the indented levels. Never more than 2. */
  depth: 0 | 1 | 2;
  /** Code and name of the parent head, or null for a major head. */
  parent: { code: string; name?: string } | null;
  /** The head names a parent that is not in the list (beyond the page limit, or removed): shown as such, not hidden. */
  parentMissing: boolean;
}

const byCode = <T extends TreeHead>(a: T, b: T) => a.code.localeCompare(b.code, "en", { numeric: true });

export function placeHeadsAsTree<T extends TreeHead & { name?: string }>(heads: readonly T[]): PlacedHead<T>[] {
  const byId = new Map<string, T>();
  for (const h of heads) if (h.id) byId.set(h.id, h);

  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const h of heads) {
    const p = h.parentId && h.parentId !== h.id ? h.parentId : null;
    if (p && byId.has(p)) {
      const list = children.get(p) ?? [];
      list.push(h);
      children.set(p, list);
    } else {
      roots.push(h);
    }
  }

  const out: PlacedHead<T>[] = [];
  const seen = new Set<T>();
  const visit = (h: T, depth: number): void => {
    if (seen.has(h)) return;
    seen.add(h);
    const parent = h.parentId && h.parentId !== h.id ? byId.get(h.parentId) : undefined;
    out.push({
      head: h,
      depth: Math.min(depth, 2) as 0 | 1 | 2,
      parent: parent ? { code: parent.code, ...(parent.name ? { name: parent.name } : {}) } : null,
      parentMissing: Boolean(h.parentId && h.parentId !== h.id && !parent),
    });
    for (const c of [...(h.id ? children.get(h.id) ?? [] : [])].sort(byCode)) visit(c, depth + 1);
  };
  for (const r of [...roots].sort(byCode)) {
    // A head whose parent is missing keeps the level the server reported as its indent, so it is not mistaken for a major head.
    visit(r, r.parentId && !byId.has(r.parentId) ? Math.min(Math.max(r.level ?? 1, 1), 2) : 0);
  }
  // Members of a parent cycle are unreachable from any root: list them last rather than lose them.
  for (const h of [...heads].filter((x) => !seen.has(x)).sort(byCode)) visit(h, 0);
  return out;
}
