/**
 * Roles the estab-service accepts on its write routes, mirrored here so the web UI
 * can hide actions the viewer cannot perform. DISPLAY gating only: the service
 * re-checks every role (requireRole) and stays the authority.
 *
 * Keep in step with services/estab-service/src/modules/<module>/routes.ts.
 */

/** files module (DAK register, dispatch delivery, open-file): modules/files/routes.ts ESTAB_ROLES. */
export const ESTAB_FILES_WRITE_ROLES = ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin"];

/** committee module (meetings, compliance register): modules/committee/routes.ts ESTAB_ROLES. */
export const ESTAB_COMMITTEE_WRITE_ROLES = ["estab_officer", "estab_admin", "super_admin"];

/** assets module (vehicles): modules/assets/routes.ts ESTAB_ROLES. */
export const ESTAB_ASSETS_WRITE_ROLES = ["estab_officer", "estab_admin", "super_admin"];
