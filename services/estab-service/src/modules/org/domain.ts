/** Org-hierarchy domain rules — pure, no I/O (gap analysis R1). */

export const ORG_UNIT_TYPES = [
  "ministry", "department", "wing", "division", "section", "desk",
] as const;
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];

/** Rank in the hierarchy — lower number = higher authority. */
const RANK: Record<OrgUnitType, number> = {
  ministry: 0, department: 1, wing: 2, division: 3, section: 4, desk: 5,
};

export function isOrgUnitType(t: string): t is OrgUnitType {
  return (ORG_UNIT_TYPES as readonly string[]).includes(t);
}

/** A ministry is the only level allowed to sit at the root (no parent). */
export function isRootType(t: OrgUnitType): boolean {
  return t === "ministry";
}

/**
 * May a unit of `childType` hang under a parent of `parentType`? The parent must
 * be strictly higher in the hierarchy (levels may be skipped — a small office
 * may have no Wing — but a Section can never parent a Division).
 */
export function canParent(childType: string, parentType: string): boolean {
  if (!isOrgUnitType(childType) || !isOrgUnitType(parentType)) return false;
  return RANK[parentType] < RANK[childType];
}

export function rankOf(t: OrgUnitType): number {
  return RANK[t];
}
