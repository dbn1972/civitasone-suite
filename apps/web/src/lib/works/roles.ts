/**
 * Works-module contractor role lists — single source of truth for the web
 * UX gates on /works/contractors, /works/contractors/new and
 * /works/contractors/[id].
 *
 * Re-derived from services/works-service/src/modules/contractor/routes.ts,
 * which is the authoritative server-side guard (the web gates below are UX /
 * defence-in-depth only; the service stays the real authority and 403s). Keep
 * these in sync with that file:
 *
 *   const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do"];
 *   const READ_ROLES  = [...WRITE_ROLES, "works_viewer", "sdo", "section_officer", "estimator"];
 *
 * GAP-WORKS-CONTRACTORS-05 / -NEW-02 / -DETAIL-02 all previously duplicated
 * these arrays by hand (contractors/[id]/page.tsx CONTRACTOR_RATE_ROLES,
 * ContractorEditToggle.tsx WRITE_ROLES); this module removes that drift.
 */

/** Roles works-service lets POST /v1/works/contractors and PATCH a contractor / rate. */
export const CONTRACTOR_WRITE_ROLES = [
  "works_admin",
  "works_operator",
  "super_admin",
  "dao",
  "do",
] as const;

/** Roles works-service lets GET the contractor register / detail / rating-history. */
export const CONTRACTOR_READ_ROLES = [
  ...CONTRACTOR_WRITE_ROLES,
  "works_viewer",
  "sdo",
  "section_officer",
  "estimator",
] as const;

/**
 * Roles permitted to reveal a contractor's clear PAN (DPDP-sensitive personal
 * data of a proprietor). DECISION (safest default, flagged for HUMAN REVIEW):
 * restricted to a tier narrower than contractor write (works_operator
 * excluded); must match PII_REVEAL_ROLES in works-service contractor/routes.ts. A plain
 * read-only role (works_viewer/estimator/section_officer) sees the masked
 * value only. The reveal is audited server-side
 * (POST /v1/works/contractors/:id/reveal-pan); UI hiding here is defence-in-
 * depth, not the boundary.
 */
export const CONTRACTOR_PII_REVEAL_ROLES = ["works_admin", "super_admin", "dao", "do"] as const;

/**
 * Roles permitted to submit a contractor performance rating. Mirrors
 * works-service's WRITE_ROLES on PATCH /v1/works/contractors/:id/rate — the
 * same set previously duplicated inline as CONTRACTOR_RATE_ROLES in
 * contractors/[id]/page.tsx.
 */
export const CONTRACTOR_RATE_ROLES: readonly string[] = [...CONTRACTOR_WRITE_ROLES];

/** True when any session role is in `allowed`. Pure; for UI gating. */
export function canAny(
  sessionRoles: readonly string[],
  allowed: readonly string[],
): boolean {
  return allowed.some((r) => sessionRoles.includes(r));
}

export function canWriteContractors(sessionRoles: readonly string[]): boolean {
  return canAny(sessionRoles, CONTRACTOR_WRITE_ROLES);
}

export function canRevealContractorPii(sessionRoles: readonly string[]): boolean {
  return canAny(sessionRoles, CONTRACTOR_PII_REVEAL_ROLES);
}
