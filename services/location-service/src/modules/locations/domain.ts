/**
 * Branch-office hierarchy domain rules.
 *
 * Pure functions only — no I/O. These encode the invariants of the location
 * tree so they can be unit-tested and reused by both create and (future) edit.
 */

/** A directed edge child -> parent in the hierarchy (parent may be null = top-level). */
export type HierarchyEdge = { id: string; parentId: string | null };

/**
 * Validates that a coordinate is within valid range.
 * Latitude: [-90, 90], Longitude: [-180, 180].
 */
export function isValidLatitude(lat: number): boolean {
  return lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number): boolean {
  return lng >= -180 && lng <= 180;
}

/**
 * Validates a lat/lng coordinate pair. Returns true if both are valid.
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/**
 * Returns true if attaching `childId` under `parentId` would create a cycle,
 * i.e. the proposed parent is the child itself or one of the child's
 * descendants. `allEdges` is the current flat set of child -> parent links.
 *
 * Used so a branch office can never end up reporting to itself or to one of
 * its own sub-offices.
 */
export function wouldCreateCycle(
  allEdges: HierarchyEdge[],
  childId: string,
  parentId: string | null
): boolean {
  // Top-level (no parent) can never create a cycle.
  if (parentId === null) return false;
  // Self-parenting is the simplest cycle.
  if (parentId === childId) return true;

  // Build a parent lookup so we can walk upward from the proposed parent.
  const parentOf = new Map<string, string | null>();
  for (const edge of allEdges) parentOf.set(edge.id, edge.parentId);

  // Walk the ancestor chain starting at the proposed parent. If we reach
  // `childId`, then `childId` is an ancestor of `parentId` and linking them
  // would form a cycle. Guard against pre-existing cycles in the data with a
  // visited set so we never loop forever.
  const visited = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor !== null) {
    if (cursor === childId) return true;
    if (visited.has(cursor)) break;
    visited.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** True when an LGD code is well formed (digits only, 1–32 chars). */
export function isValidLgdCode(code: string): boolean {
  return /^\d{1,32}$/.test(code);
}
