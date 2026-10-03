export type Location = {
  id: string; code: string; name: string; orgUnit?: string | null; parentId?: string | null;
  /** GAP-ASSETS-LOCATIONS-02: false once deactivated; absent on payloads from before the column existed (treated as active). */
  isActive?: boolean;
};

export const isLocationActive = (l: Pick<Location, "isActive">): boolean => l.isActive !== false;

export type LocationNode = Location & { children: LocationNode[] };
export type FlatLocation = Location & { depth: number };

/** GAP-ASSETS-LOCATIONS-02: codes compare trimmed and case-insensitively (the server stores what was typed). */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** True when `code` already exists in `rows` (optionally ignoring one row, for edits). */
export function hasDuplicateCode(rows: readonly Location[], code: string, ignoreId?: string): boolean {
  const n = normalizeCode(code);
  if (!n) return false;
  return rows.some((r) => r.id !== ignoreId && normalizeCode(r.code) === n);
}

/**
 * GAP-ASSETS-LOCATIONS-01: nests the flat list by parentId. A row whose parent is
 * missing from the list (not loaded / deleted) is shown as a root rather than
 * dropped, and a malformed parent cycle cannot recurse forever: every row is
 * placed at most once. Siblings are ordered by code.
 */
export function buildLocationTree(rows: readonly Location[]): LocationNode[] {
  const nodes = new Map<string, LocationNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: LocationNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && !isAncestor(nodes, node.id, parent.id)) parent.children.push(node);
    else roots.push(node);
  }
  const byCode = (a: LocationNode, b: LocationNode) => a.code.localeCompare(b.code);
  const sortDeep = (list: LocationNode[]) => {
    list.sort(byCode);
    for (const n of list) sortDeep(n.children);
  };
  sortDeep(roots);
  return roots;
}

/** True if `candidateAncestorId` is `id` itself or sits below `id` -- i.e. making it the parent would form a cycle. */
function isAncestor(nodes: Map<string, LocationNode & { children: LocationNode[] }>, id: string, candidateParentId: string): boolean {
  const seen = new Set<string>();
  let cur: string | null | undefined = candidateParentId;
  while (cur && !seen.has(cur)) {
    if (cur === id) return true;
    seen.add(cur);
    cur = nodes.get(cur)?.parentId;
  }
  return false;
}

/** Locations a NEW child / asset may be placed under: active ones only. */
export function activeOnly<T extends Pick<Location, "isActive">>(rows: readonly T[]): T[] {
  return rows.filter(isLocationActive);
}

/** Depth-first flattening of the tree, used for the indented parent <select>. */
export function flattenTree(roots: readonly LocationNode[], depth = 0): FlatLocation[] {
  const out: FlatLocation[] = [];
  for (const n of roots) {
    const { children, ...row } = n;
    out.push({ ...row, depth });
    out.push(...flattenTree(children, depth + 1));
  }
  return out;
}

/** Org-unit names offered by the picker; the column is varchar(64), so longer names are not offered. */
export function orgUnitNames(payload: unknown): string[] {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const names = new Set<string>();
  for (const r of rows) {
    const name = typeof (r as { name?: unknown })?.name === "string" ? (r as { name: string }).name.trim() : "";
    if (name && name.length <= 64) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Fetch every page of locations (the API caps a page at 100) so the tree is complete. */
export async function fetchAllLocations(
  fetchPage: (offset: number, limit: number) => Promise<Location[] | null>,
  pageSize = 100,
  maxPages = 50,
): Promise<Location[] | null> {
  const all: Location[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(page * pageSize, pageSize);
    if (rows === null) return null;
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
