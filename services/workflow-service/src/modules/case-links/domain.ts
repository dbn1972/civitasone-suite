/**
 * CAP-033 — generic case relationship model (pure domain).
 *
 * Cases can be linked as parent/child, related, duplicate-of, or produced by a
 * split or merge. The dangerous invariant is that the *containment* graph
 * (parent_child / split_from / merged_from) must stay acyclic — a cycle would
 * make "roll up to parent" or "collapse duplicates" loop forever. This module
 * is the pure guard + planning logic; persistence and audit are the caller's.
 */

export type LinkType =
  | "parent_child"
  | "related"
  | "duplicate_of"
  | "split_from"
  | "merged_from";

export const LINK_TYPES: readonly LinkType[] = [
  "parent_child",
  "related",
  "duplicate_of",
  "split_from",
  "merged_from",
] as const;

/** A stored link: `fromCaseId` relates to `toCaseId` as `type`. */
export interface CaseLink {
  fromCaseId: string;
  toCaseId: string;
  type: LinkType;
}

export interface GuardResult {
  allowed: boolean;
  errors: string[];
}

/**
 * Map a link to a directed containment edge (ancestor -> descendant), or null
 * when the link type does not participate in the containment hierarchy
 * (`related`, `duplicate_of`). Semantics:
 *  - parent_child(from,to): from is the parent  => edge from -> to
 *  - split_from(from,to):   from was split out of to (to is the parent) => to -> from
 *  - merged_from(from,to):  to was merged into from (from is the survivor) => from -> to
 */
export function containmentEdge(link: CaseLink): { ancestor: string; descendant: string } | null {
  switch (link.type) {
    case "parent_child":
      return { ancestor: link.fromCaseId, descendant: link.toCaseId };
    case "split_from":
      return { ancestor: link.toCaseId, descendant: link.fromCaseId };
    case "merged_from":
      return { ancestor: link.fromCaseId, descendant: link.toCaseId };
    default:
      return null;
  }
}

/**
 * True when adding the containment edge `ancestor -> descendant` would create a
 * cycle, i.e. `ancestor` is already reachable from `descendant` in the existing
 * containment graph (or they are the same node).
 */
export function wouldCreateCycle(
  existing: CaseLink[],
  ancestor: string,
  descendant: string,
): boolean {
  if (ancestor === descendant) return true;
  const adj = new Map<string, string[]>();
  for (const link of existing) {
    const e = containmentEdge(link);
    if (!e) continue;
    const list = adj.get(e.ancestor) ?? [];
    list.push(e.descendant);
    adj.set(e.ancestor, list);
  }
  // Can we get back to `ancestor` starting from `descendant`?
  const seen = new Set<string>();
  const stack = [descendant];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === ancestor) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adj.get(node) ?? []) stack.push(next);
  }
  return false;
}

export interface ValidateLinkInput {
  fromCaseId: string;
  toCaseId: string;
  type: LinkType;
  /** Links already present for this tenant (any pair). */
  existing: CaseLink[];
}

/**
 * Validate a proposed link. Collects every failure so the caller can 4xx with
 * all reasons at once. Error codes are stable strings.
 */
export function validateLink(input: ValidateLinkInput): GuardResult {
  const errors: string[] = [];
  const { fromCaseId, toCaseId, type, existing } = input;

  if (!LINK_TYPES.includes(type)) errors.push("UNKNOWN_LINK_TYPE");
  if (fromCaseId === toCaseId) errors.push("SELF_LINK");

  const dup = existing.some(
    (l) => l.fromCaseId === fromCaseId && l.toCaseId === toCaseId && l.type === type,
  );
  if (dup) errors.push("DUPLICATE_LINK");

  // A case already marked as a duplicate-of another cannot itself be the
  // canonical target of a new duplicate-of link (blocks duplicate chains).
  if (type === "duplicate_of") {
    const targetIsDuplicate = existing.some(
      (l) => l.type === "duplicate_of" && l.fromCaseId === toCaseId,
    );
    if (targetIsDuplicate) errors.push("DUPLICATE_OF_A_DUPLICATE");
  }

  const edge = containmentEdge({ fromCaseId, toCaseId, type });
  if (edge && wouldCreateCycle(existing, edge.ancestor, edge.descendant)) {
    errors.push("CYCLE_DETECTED");
  }

  return { allowed: errors.length === 0, errors };
}

export interface SplitChildSpec {
  title: string;
  caseType: string;
  allocation?: number | undefined; // percent (0,100]
  assigneeId?: string | undefined;
}

export interface SplitPlan {
  allowed: boolean;
  errors: string[];
  children: SplitChildSpec[];
}

/**
 * Validate a split of one parent case into >= 2 children. When allocations are
 * supplied every child must carry one, each in (0,100], summing to 100 (±0.01).
 * When none are supplied the split is qualitative (no allocation check).
 */
export function planSplit(children: SplitChildSpec[]): SplitPlan {
  const errors: string[] = [];
  if (children.length < 2) errors.push("SPLIT_NEEDS_TWO_CHILDREN");

  const withAlloc = children.filter((c) => c.allocation !== undefined);
  if (withAlloc.length > 0) {
    if (withAlloc.length !== children.length) errors.push("PARTIAL_ALLOCATION");
    for (const c of withAlloc) {
      if (!(c.allocation! > 0 && c.allocation! <= 100)) errors.push("ALLOCATION_OUT_OF_RANGE");
    }
    const sum = withAlloc.reduce((s, c) => s + (c.allocation ?? 0), 0);
    if (Math.abs(sum - 100) > 0.01) errors.push("ALLOCATION_SUM_NOT_100");
  }

  return { allowed: errors.length === 0, errors, children };
}

export interface MergePlan {
  allowed: boolean;
  errors: string[];
}

/**
 * Validate a merge of >= 2 source cases into one target. The target may not be
 * among the sources and sources must be distinct.
 */
export function planMerge(sourceIds: string[], targetId: string): MergePlan {
  const errors: string[] = [];
  if (sourceIds.length < 2) errors.push("MERGE_NEEDS_TWO_SOURCES");
  if (sourceIds.includes(targetId)) errors.push("TARGET_IN_SOURCES");
  if (new Set(sourceIds).size !== sourceIds.length) errors.push("DUPLICATE_SOURCES");
  return { allowed: errors.length === 0, errors };
}
