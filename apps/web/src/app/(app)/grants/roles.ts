/**
 * Grants role constants — the single source of truth for web-side gating of
 * every /grants route and control. These MIRROR the role lists the
 * grant-service already enforces server-side (the server remains the
 * authority; these only decide what the UI offers / which routes redirect):
 *
 *  - scheme create/close + application submit/approve/reject:
 *      grant-service modules/scheme/routes.ts SCHEME_ROLES and
 *      modules/application/routes.ts GRANT_ROLES — both
 *      ["grant_officer", "grant_admin", "super_admin"].
 *  - read (list/detail): grant-service READER_ROLES — the maker roles plus
 *      audit_officer / finance_officer / grant_viewer (scheme) and
 *      grant_reviewer / audit_officer (application).
 *  - UC validation (checker): grant-service modules/uc-validation/routes.ts
 *      GRANT_ROLES — ["grant_officer", "grant_admin", "finance_admin",
 *      "super_admin"] — plus the service's own separation-of-duties rule
 *      (the validator must differ from the UC submitter).
 *
 * DECISION (recorded for GAP-GRANTS-*-01, conservative/safest-default): the
 * audit snapshot found no grants role constant in apps/web and only
 * "grant_admin" referenced anywhere; rather than invent maker/checker names we
 * adopt EXACTLY the names grant-service enforces, so a wrong list can only ever
 * be more restrictive than the backend, never looser.
 */

/** May view any grants page (list + detail). Superset — mirrors the service READER_ROLES union. */
export const GRANTS_VIEW_ROLES = [
  "grant_officer",
  "grant_admin",
  "grant_reviewer",
  "grant_viewer",
  "finance_officer",
  "finance_admin",
  "audit_officer",
  "super_admin",
];

/** May create schemes, close schemes, and submit/approve/reject applications (maker). */
export const GRANTS_MAKER_ROLES = ["grant_officer", "grant_admin", "super_admin"];

/** May verify/reject utilisation certificates (checker). Mirrors uc-validation GRANT_ROLES. */
export const GRANTS_UC_VALIDATE_ROLES = ["grant_officer", "grant_admin", "finance_admin", "super_admin"];

/**
 * May schedule/release installments (the PFMS disbursement maker action).
 * Mirrors grant-service modules/disbursement/routes.ts GRANT_ROLES exactly
 * (["grant_officer", "grant_admin", "super_admin", "finance_officer"]) — the
 * POST .../installments/:id/disburse gate. Separate from GRANTS_MAKER_ROLES
 * (scheme/application maker) because disbursement adds finance_officer.
 * GAP-GRANTS-INSTALLMENTS-01: the Release control is shown only to these roles.
 */
export const GRANTS_DISBURSE_ROLES = ["grant_officer", "grant_admin", "super_admin", "finance_officer"];

/**
 * May approve/reject a release (checker). DECISION (GAP-GRANTS-RELEASES-01/02,
 * safest default — flagged for HUMAN REVIEW): a release approval is a money-out
 * control, so it is NARROWER than the disburse maker set — a plain
 * grant_officer / finance_officer must not self-approve. Restricted to
 * grant_admin + super_admin. The server must enforce the same (maker != checker)
 * once the approve endpoint exists; until then the UI hides it behind a flag.
 */
export const GRANTS_RELEASE_APPROVE_ROLES = ["grant_admin", "super_admin"];

/**
 * May score / submit an evaluation for an application. Mirrors
 * grant-service modules/application/routes.ts REVIEW_ROLES =
 * grant_reviewer + the maker set. GAP-GRANTS-APPLICATIONS-DETAIL-01/02.
 */
export const GRANT_REVIEWER_ROLES = ["grant_reviewer", ...GRANTS_MAKER_ROLES];
