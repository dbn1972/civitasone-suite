/**
 * Pure domain logic for account hierarchy (CM-002).
 * Cycle detection: given a proposed parent, ensures no circular reference.
 */

export interface AccountNode {
  id: string;
  parentId: string | null;
}

/**
 * Detects if setting `childId.parentId = newParentId` would introduce a cycle.
 * Walks the parent chain of `newParentId` upward. If we encounter `childId`,
 * it would form a loop.
 *
 * @returns true if a cycle WOULD be created (invalid move)
 */
export function wouldCreateCycle(
  childId: string,
  newParentId: string,
  accountsMap: Map<string, AccountNode>,
): boolean {
  if (childId === newParentId) return true;

  let current: string | null = newParentId;
  const visited = new Set<string>();

  while (current !== null) {
    if (current === childId) return true;
    if (visited.has(current)) return true; // existing cycle in data (defensive)
    visited.add(current);
    const node = accountsMap.get(current);
    current = node?.parentId ?? null;
  }

  return false;
}

/**
 * Builds the ancestor chain (parent → grandparent → ...) for a given account.
 * Returns ancestors in order from immediate parent to root.
 */
export function buildAncestorChain(
  accountId: string,
  accountsMap: Map<string, AccountNode>,
  maxDepth = 50,
): string[] {
  const ancestors: string[] = [];
  let current: string | null = accountsMap.get(accountId)?.parentId ?? null;
  const visited = new Set<string>();

  while (current !== null && ancestors.length < maxDepth) {
    if (visited.has(current)) break; // break on cycle in data
    visited.add(current);
    ancestors.push(current);
    const node = accountsMap.get(current);
    current = node?.parentId ?? null;
  }

  return ancestors;
}
