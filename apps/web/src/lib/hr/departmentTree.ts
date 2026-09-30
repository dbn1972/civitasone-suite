/**
 * GAP-HR-DEPARTMENTS-03: shared tree helpers for department parent-selection
 * UI. Used by both the departments list's inline re-parent select
 * (DepartmentsTable.tsx) and the "Add Department" form's parent select
 * (departments/new/AddDepartmentForm.tsx) so the two never drift on how a
 * cycle is excluded or how the indented option list is built.
 */

export type MinimalDept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
};

export type DeptTreeNode<T extends MinimalDept> = T & { children: DeptTreeNode<T>[] };

export function buildDepartmentTree<T extends MinimalDept>(flat: T[]): DeptTreeNode<T>[] {
  const byId = new Map<string, DeptTreeNode<T>>(
    flat.map((d) => [d.id, { ...d, children: [] }]),
  );
  const roots: DeptTreeNode<T>[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** `id` itself plus every department reachable from it via `children` --
 * i.e. every choice that would create a cycle if picked as `id`'s new
 * parent. */
export function selfAndDescendantIds(id: string, flat: MinimalDept[]): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const d of flat) {
    if (!d.parentId) continue;
    const list = byParent.get(d.parentId) ?? [];
    list.push(d.id);
    byParent.set(d.parentId, list);
  }
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const childId of byParent.get(cur) ?? []) {
      if (!out.has(childId)) {
        out.add(childId);
        stack.push(childId);
      }
    }
  }
  return out;
}

/** Flattens a department (sub-)tree into a depth-indented, readable option
 * list for a <select>. A node whose real parent was excluded upstream (e.g.
 * it's a descendant of the department being edited) just falls back to
 * appearing at the top level here -- harmless, still a valid, non-cyclic
 * choice. */
export function flattenDepartmentsForSelect<T extends MinimalDept>(
  nodes: DeptTreeNode<T>[],
  depth = 0,
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, label: `${"— ".repeat(depth)}${n.code} · ${n.name}` });
    out.push(...flattenDepartmentsForSelect(n.children, depth + 1));
  }
  return out;
}

/** Eligible-parent option list for editing/creating department `excludeId`
 * (pass `null` when creating a brand-new department, which excludes
 * nothing). */
export function eligibleParentOptions<T extends MinimalDept>(
  all: T[],
  excludeId: string | null,
): { id: string; label: string }[] {
  const excluded = excludeId ? selfAndDescendantIds(excludeId, all) : new Set<string>();
  const eligible = all.filter((d) => !excluded.has(d.id));
  return flattenDepartmentsForSelect(buildDepartmentTree(eligible));
}
