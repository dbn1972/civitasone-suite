/**
 * Segments domain logic — criteria validation and segment query building.
 * Supports filtering by role, department_id, location_id, and custom attributes (AND logic).
 */

export type SegmentCriteria = {
  roles?: string[] | undefined;
  departmentIds?: string[] | undefined;
  locationIds?: string[] | undefined;
  attributes?: Record<string, string | string[]> | undefined;
};

export type SegmentFilter = {
  field: string;
  operator: "eq" | "in" | "contains";
  value: string | string[];
};

/**
 * Validate that criteria is well-formed and non-empty.
 * Returns an error message string or null if valid.
 */
export function validateCriteria(criteria: unknown): string | null {
  if (!criteria || typeof criteria !== "object") {
    return "criteria must be a non-empty object";
  }

  const c = criteria as SegmentCriteria;
  const hasRoles = Array.isArray(c.roles) && c.roles.length > 0;
  const hasDepts = Array.isArray(c.departmentIds) && c.departmentIds.length > 0;
  const hasLocations = Array.isArray(c.locationIds) && c.locationIds.length > 0;
  const hasAttributes = c.attributes && typeof c.attributes === "object" && Object.keys(c.attributes).length > 0;

  if (!hasRoles && !hasDepts && !hasLocations && !hasAttributes) {
    return "criteria must contain at least one filter (roles, departmentIds, locationIds, or attributes)";
  }

  // Validate roles are non-empty strings
  if (hasRoles && c.roles!.some((r) => typeof r !== "string" || r.length === 0)) {
    return "roles must be an array of non-empty strings";
  }

  // Validate department IDs are UUID-like strings
  if (hasDepts && c.departmentIds!.some((d) => typeof d !== "string" || d.length === 0)) {
    return "departmentIds must be an array of non-empty strings";
  }

  // Validate location IDs
  if (hasLocations && c.locationIds!.some((l) => typeof l !== "string" || l.length === 0)) {
    return "locationIds must be an array of non-empty strings";
  }

  return null;
}

/**
 * Build a list of structured filters from segment criteria (AND logic).
 * These filters are applied when resolving the segment against a user registry.
 */
export function buildSegmentQuery(criteria: SegmentCriteria): SegmentFilter[] {
  const filters: SegmentFilter[] = [];

  if (criteria.roles && criteria.roles.length > 0) {
    filters.push({ field: "role", operator: "in", value: criteria.roles });
  }

  if (criteria.departmentIds && criteria.departmentIds.length > 0) {
    filters.push({ field: "department_id", operator: "in", value: criteria.departmentIds });
  }

  if (criteria.locationIds && criteria.locationIds.length > 0) {
    filters.push({ field: "location_id", operator: "in", value: criteria.locationIds });
  }

  if (criteria.attributes) {
    for (const [key, value] of Object.entries(criteria.attributes)) {
      if (Array.isArray(value)) {
        filters.push({ field: `attr.${key}`, operator: "in", value });
      } else {
        filters.push({ field: `attr.${key}`, operator: "eq", value });
      }
    }
  }

  return filters;
}

/**
 * Validate that a resolved segment is non-empty.
 * Returns true if at least one recipient matched.
 */
export function isSegmentNonEmpty(recipientCount: number): boolean {
  return recipientCount > 0;
}
