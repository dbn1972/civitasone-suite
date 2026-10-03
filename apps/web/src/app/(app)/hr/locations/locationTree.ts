/**
 * Pure helpers for the location edit flow (GAP-HR-LOCATIONS-02).
 * Mirrors the service's wouldCreateCycle rule so the form never offers a
 * parent the server would refuse.
 */
export interface TreeNode { id: string; parentId?: string | null }

/** Ids of every descendant of `rootId` (children, grandchildren, ...). Cycle-safe. */
export function descendantIds(rows: TreeNode[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = childrenOf.get(r.parentId) ?? [];
    list.push(r.id);
    childrenOf.set(r.parentId, list);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const child of childrenOf.get(cur) ?? []) {
      if (!out.has(child) && child !== rootId) { out.add(child); stack.push(child); }
    }
  }
  return out;
}

/** Locations that may be offered as the parent of `selfId`: not itself, not a descendant, not archived. */
export function selectableParents<T extends TreeNode & { status?: string }>(rows: T[], selfId: string): T[] {
  const banned = descendantIds(rows, selfId);
  banned.add(selfId);
  return rows.filter((r) => !banned.has(r.id) && r.status !== "archived");
}

export interface EditableFields {
  name: string; type: string; parentId: string | null;
  addressLine: string | null; city: string | null; postalCode: string | null; lgdCode: string | null;
}

/**
 * The PATCH body for an edit: ONLY fields that changed. A cleared optional
 * text field is sent as null (the service accepts null to clear); an
 * unchanged form yields an empty patch (the caller shows "no changes").
 */
export function buildLocationPatch(before: EditableFields, after: EditableFields): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  const keys: (keyof EditableFields)[] = ["name", "type", "parentId", "addressLine", "city", "postalCode", "lgdCode"];
  for (const k of keys) {
    const a = after[k] === "" ? null : after[k];
    const b = before[k] === "" ? null : before[k];
    if (a !== b) patch[k] = a;
  }
  return patch;
}
