/**
 * GAP-TENANT-ORG-HIERARCHY-01: tenant-service GET /v1/org/hierarchy (relayed by
 * admin-service /v1/admin/org-hierarchy) returns FLAT org_units, each with a
 * `parentId`. The tree page renders nested `children`, so without this a child
 * unit showed at the root level, not indented under its parent.
 */
export type OrgTreeNode = {
  id: string;
  name: string;
  headCount?: number | null;
  children?: OrgTreeNode[];
};

type FlatRow = { id: string; name: string; headCount?: number | null; parentId: string | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function buildOrgTree(rows: unknown[]): OrgTreeNode[] {
  const flat: FlatRow[] = [];
  let anyNested = false;
  for (const r of rows) {
    if (!isRecord(r) || typeof r.id !== "string") continue;
    if (Array.isArray(r.children)) anyNested = true;
    flat.push({
      id: r.id,
      name: typeof r.name === "string" ? r.name : "",
      ...(typeof r.headCount === "number" || r.headCount === null ? { headCount: r.headCount as number | null } : {}),
      parentId: typeof r.parentId === "string" ? r.parentId : null,
    });
  }
  // Already a tree (a nested payload): pass it through untouched.
  if (anyNested) return rows.filter((r): r is OrgTreeNode => isRecord(r) && typeof r.id === "string");

  const ids = new Set(flat.map((r) => r.id));
  const kids = new Map<string, FlatRow[]>();
  const roots: FlatRow[] = [];
  for (const r of flat) {
    if (r.parentId && r.parentId !== r.id && ids.has(r.parentId)) {
      const list = kids.get(r.parentId) ?? [];
      list.push(r);
      kids.set(r.parentId, list);
    } else {
      roots.push(r); // no parent, or parent not in this payload: never drop a unit
    }
  }

  const seen = new Set<string>();
  const build = (r: FlatRow): OrgTreeNode => {
    seen.add(r.id);
    const children = (kids.get(r.id) ?? []).filter((c) => !seen.has(c.id)).map(build);
    return {
      id: r.id,
      name: r.name,
      ...(r.headCount !== undefined ? { headCount: r.headCount } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  };
  const tree = roots.map(build);
  // A parent cycle has no root: surface its members as roots rather than dropping them.
  for (const r of flat) if (!seen.has(r.id)) tree.push(build(r));
  return tree;
}
