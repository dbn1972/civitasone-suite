import { TENANT_ADMIN_ROLES, CONSENT_DECISION_ROLES, MIGRATION_RETRY_ROLES, AUDIT_REVEAL_ROLES, SESSION_IP_REVEAL_ROLES } from "./_roles";

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
  { prefix: "/tenant/data-migration", roles: MIGRATION_RETRY_ROLES },
  { prefix: "/tenant-admin/audit", roles: AUDIT_REVEAL_ROLES },
  { prefix: "/tenant-admin/sessions", roles: SESSION_IP_REVEAL_ROLES },
];

/** Roles the /tenant and /tenant-admin layouts admit for this request path. */
export function adminAreaRoles(pathname: string | null): string[] {
  if (!pathname) return TENANT_ADMIN_ROLES;
  const extra = OFFICER_ROUTE_ROLES.filter((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)).flatMap((r) => [...r.roles]);
  return extra.length ? [...TENANT_ADMIN_ROLES, ...extra] : TENANT_ADMIN_ROLES;
}
