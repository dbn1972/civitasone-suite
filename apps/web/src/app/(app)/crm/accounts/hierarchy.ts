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
