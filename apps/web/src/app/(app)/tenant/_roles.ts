/**
 * Role sets for the /tenant web area (GAP-TENANT-HOME-01, HOME-02,
 * CONSENT-EXCHANGE-02). Kept in one place so the layout gate, the hub tile
 * visibility and the page tests all agree on a single list. These mirror the
 * tenant-admin role set used by tenant-admin/layout.tsx. The authoritative
 * control is server-side in tenant-service; these only decide what the web
 * renders / which route the user may reach.
 */
export const TENANT_ADMIN_ROLES = ["tenant_admin", "platform_admin", "super_admin"];

/**
 * OWNER DECISION #19 (TENANT-CONSENT-EXCHANGE-01): only the consent officer (DPO)
 * may approve or reject a consent request on behalf of the data principal.
 * tenant_admin is view-only. tenant-service re-enforces this server-side.
 */
export const CONSENT_DECISION_ROLES = ["consent_officer"];

/**
 * OWNER DECISION #23 (TENANT-DATA-MIGRATION-01): only the migration admin may
 * retry the failed records of an import. tenant-service re-enforces this.
 */
export const MIGRATION_RETRY_ROLES = ["migration_admin"];

/**
 * Route-scoped officer roles. The owner decisions reserve four actions to officer
 * roles that are NOT tenant admins (#19 consent_officer, #20 audit_officer, #21
 * security_admin, #23 migration_admin). The /tenant and /tenant-admin layouts gate
 * the whole area to TENANT_ADMIN_ROLES, so without this an account holding only an
 * officer role was bounced before it reached the screen that carries its action.
 * Each officer role is admitted ONLY to its own route prefix; every other page in
 * the area stays tenant-admin only. tenant-service / audit-service / identity-service
 * re-enforce the same roles server-side.
 */
export const OFFICER_ROUTE_ROLES: ReadonlyArray<{ prefix: string; roles: readonly string[] }> = [
  { prefix: "/tenant/consent-exchange", roles: CONSENT_DECISION_ROLES },
];

/** Roles the /tenant and /tenant-admin layouts admit for this request path. */
export function adminAreaRoles(pathname: string | null): string[] {
  if (!pathname) return TENANT_ADMIN_ROLES;
  const extra = OFFICER_ROUTE_ROLES.filter((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)).flatMap((r) => [...r.roles]);
  return extra.length ? [...TENANT_ADMIN_ROLES, ...extra] : TENANT_ADMIN_ROLES;
}
