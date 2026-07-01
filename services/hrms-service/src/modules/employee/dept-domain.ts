/**
 * Department hierarchy domain logic — pure validation for org-structure compliance.
 * Enforces: child level must be > parent level; type vocabularies per edition.
 */

/** Central Government hierarchy types (CSMOP). */
export const CENTRAL_GOVT_TYPES = [
  "ministry", "department", "attached_office", "subordinate_office",
  "wing", "division", "branch", "section", "desk",
] as const;

/** State Government hierarchy types. */
export const STATE_GOVT_TYPES = [
  "department", "directorate", "regional_office", "district_office",
  "division", "section", "desk",
] as const;

/** Local Body hierarchy types. */
export const LOCAL_BODY_TYPES = [
  "corporation", "council", "panchayat", "department",
  "zone", "ward_office", "section", "desk",
] as const;

/** Statutory/Autonomous Body hierarchy types. */
export const STATUTORY_TYPES = [
  "board", "commission", "authority", "council", "university", "institute",
  "department", "regional_office", "division", "section", "desk",
] as const;

/** PSU hierarchy types. */
export const PSU_TYPES = [
  "company", "corporate", "region", "zone", "plant", "depot", "unit",
  "department", "division", "section",
] as const;

/** Private company hierarchy types. */
export const PRIVATE_TYPES = [
  "company", "business_unit", "vertical", "function", "practice",
  "delivery_center", "department", "section", "team",
] as const;

/** NGO / Section 8 hierarchy types. */
export const NGO_TYPES = [
  "organisation", "company", "department", "program",
  "state_unit", "district_unit", "region", "section", "team",
] as const;

/** Cooperative hierarchy types. */
export const COOPERATIVE_TYPES = [
  "federation", "district_union", "society", "corporate", "plant",
  "division", "department", "section",
] as const;

/** Small office hierarchy types. */
export const SMALL_OFFICE_TYPES = [
  "firm", "office", "department", "section",
] as const;

/**
 * Validate that a child's numeric level is strictly greater than its parent's level.
 * Returns true if valid, false if the hierarchy is violated.
 */
export function isValidHierarchyLevel(childLevel: number | null | undefined, parentLevel: number | null | undefined): boolean {
  if (childLevel == null || parentLevel == null) return true; // if levels aren't set, skip enforcement
  return childLevel > parentLevel;
}

/**
 * Check whether a given type string is in the vocabulary for the dept's context.
 * Returns true if valid (or if no vocabulary applies — e.g. type is null).
 */
export function isValidDeptType(type: string | null | undefined, govtTier: string | null | undefined): boolean {
  if (!type) return true; // no type = freeform (small offices don't need it)
  const allTypes: readonly string[] = [
    ...CENTRAL_GOVT_TYPES, ...STATE_GOVT_TYPES, ...LOCAL_BODY_TYPES,
    ...STATUTORY_TYPES, ...PSU_TYPES, ...PRIVATE_TYPES, ...NGO_TYPES,
    ...COOPERATIVE_TYPES, ...SMALL_OFFICE_TYPES,
  ];
  return allTypes.includes(type);
}
