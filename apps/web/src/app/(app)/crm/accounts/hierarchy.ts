import type { CRMAccountSummary } from "@civitasone/types";

export type AccountTreeRow = CRMAccountSummary & { depth: number };

/**
 * Flattens the account list into a depth-annotated, parent-before-child order
 * suitable for an indented tree.
 *
 * An account whose `parentId` is not present in the supplied list is treated as
 * a root so that partial pages (the API caps the list) never hide rows. Cycles
 * left behind by legacy data are broken by visiting each account at most once.
 */
export function buildAccountTree(accounts: CRMAccountSummary[]): AccountTreeRow[] {
  const byParent = new Map<string | null, CRMAccountSummary[]>();
  const present = new Set(accounts.map((a) => a.id));

  for (const account of accounts) {
    const key = account.parentId && present.has(account.parentId) ? account.parentId : null;
    const siblings = byParent.get(key);
    if (siblings) siblings.push(account);
    else byParent.set(key, [account]);
  }

  const rows: AccountTreeRow[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number): void => {
    for (const account of byParent.get(parentId) ?? []) {
      if (visited.has(account.id)) continue;
      visited.add(account.id);
      rows.push({ ...account, depth });
      walk(account.id, depth + 1);
    }
  };

  walk(null, 0);

  // Anything still unvisited sits in a cycle — surface it rather than drop it.
  for (const account of accounts) {
    if (!visited.has(account.id)) {
      visited.add(account.id);
      rows.push({ ...account, depth: 0 });
    }
  }

  return rows;
}

/** Number of accounts that sit under another account. */
export function countSubsidiaries(accounts: CRMAccountSummary[]): number {
  const present = new Set(accounts.map((a) => a.id));
  return accounts.filter((a) => a.parentId && present.has(a.parentId)).length;
}

export type AccountTreeNode = CRMAccountSummary & { children: AccountTreeNode[] };

/**
 * Builds a true nested parent→children tree (not a flat depth-annotated list)
 * so the UI can emit nested <ul>/<li> that assistive tech announces as a list
 * with real nesting, instead of a role="tree" widget that lacks arrow-key
 * behaviour (GAP-CRM-ACCOUNTS-06). Same root/cycle rules as buildAccountTree:
 * an account whose parent is absent is a root, and cycles are broken by
 * visiting each account at most once.
 */
export function buildNestedAccountTree(accounts: CRMAccountSummary[]): AccountTreeNode[] {
  const byParent = new Map<string | null, CRMAccountSummary[]>();
  const present = new Set(accounts.map((a) => a.id));

  for (const account of accounts) {
    const key = account.parentId && present.has(account.parentId) ? account.parentId : null;
    const siblings = byParent.get(key);
    if (siblings) siblings.push(account);
    else byParent.set(key, [account]);
  }

  const visited = new Set<string>();

  const build = (parentId: string | null): AccountTreeNode[] => {
    const nodes: AccountTreeNode[] = [];
    for (const account of byParent.get(parentId) ?? []) {
      if (visited.has(account.id)) continue;
      visited.add(account.id);
      nodes.push({ ...account, children: build(account.id) });
    }
    return nodes;
  };

  const roots = build(null);

  // Anything still unvisited sits in a cycle — surface it at the root rather
  // than drop it.
  for (const account of accounts) {
    if (!visited.has(account.id)) {
      visited.add(account.id);
      roots.push({ ...account, children: [] });
    }
  }

  return roots;
}

/**
 * All descendant ids of `rootId` within the supplied list (children, their
 * children, …), excluding `rootId` itself. Used by the re-parent form to stop
 * an account being moved under one of its own descendants — which would create
 * a cycle (GAP-CRM-ACCOUNTS-DETAIL-03). Cycle-safe: each id is visited once.
 */
export function collectDescendantIds(accounts: CRMAccountSummary[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const a of accounts) {
    if (!a.parentId) continue;
    const list = childrenByParent.get(a.parentId);
    if (list) list.push(a.id);
    else childrenByParent.set(a.parentId, [a.id]);
  }
  const descendants = new Set<string>();
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (descendants.has(id)) continue;
    descendants.add(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child);
  }
  return descendants;
}
