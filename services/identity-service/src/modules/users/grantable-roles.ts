/**
 * Role governance for roles granted at user-create time and by the role-change endpoint.
 *
 * Roles live in Keycloak (realm roles); every service gates on the realm role names in the token. The
 * allow-list below is the ONLY set of roles these two paths can ever grant or remove. Anything else
 * (tenant_admin, super_admin, platform_admin, admin, service_account, security/audit roles, citizen and
 * device roles, anything unknown) is refused, so a tenant admin cannot mint a platform operator, a second
 * tenant admin or a service account through here. Those keep their own governed paths (tenant onboarding,
 * Platform Operators maker-checker, break-glass).
 *
 * Two tiers:
 *   staff : ordinary employee / officer / departmental working roles. Any caller who may call the user
 *           admin routes (tenant_admin, platform_admin, super_admin) may grant them.
 *   admin : departmental *_admin roles. The caller must hold the role themselves (a tenant admin holds the
 *           bootstrap bundle hr/finance/payroll/procurement admin), or be platform_admin / super_admin acting
 *           for the tenant. A caller can never hand out an admin role they do not hold.
 *
 * Pure functions, no I/O, so the same check runs in the HTTP command AND again in the worker consumer
 * (defence in depth against a command that reached the queue another way).
 */

export const DEFAULT_ROLE = "employee";

export const STAFF_ROLES = [
  "employee", "manager", "officer", "section_officer", "dept_officer", "dept_head",
  "supervising_officer", "reviewing_officer", "engineer", "field_engineer", "inspector", "qc_inspector",
  "observer", "auditor", "committee_member", "committee_secretary", "committee_chairperson", "bid_opening_committee",
  "hr_officer", "finance_officer", "payroll_officer", "procurement_officer", "budget_officer",
  "revenue_officer", "revenue_collector", "revenue_analyst", "estab_officer", "records_officer", "legal_officer",
  "vigilance_officer", "grievance_officer", "consent_officer", "sales_officer", "front_desk",
  "store_keeper", "store_officer", "warehouse_officer", "inventory_user", "inventory_manager", "asset_manager",
  "project_manager", "project_officer", "helpdesk_user", "helpdesk_agent", "crm_user", "citizen_officer",
] as const;

export const ADMIN_TIER_ROLES = [
  "hr_admin", "finance_admin", "payroll_admin", "procurement_admin", "asset_admin", "contract_admin",
  "crm_admin", "estab_admin", "inspection_admin", "inventory_admin", "legal_admin", "meeting_admin",
  "project_admin", "revenue_admin", "works_admin", "helpdesk_admin", "vigilance_admin", "citizen_admin",
] as const;

/** Never grantable here, listed so the refusal can say why. Belt and braces: they are also simply not in the allow-list. */
export const PLATFORM_ROLES = [
  "super_admin", "platform_admin", "admin", "tenant_admin", "service_account", "migration_admin", "install_admin",
  "security_admin", "audit_admin", "billing_admin", "gate_terminal", "citizen", "data_principal",
] as const;

const PLATFORM_CALLERS = ["platform_admin", "super_admin"] as const;
/** Roles that may drive the user-admin routes at all. The worker insists its re-derived grantor holds one. */
export const USER_ADMIN_ROLES = ["platform_admin", "super_admin", "tenant_admin"] as const;

export type GrantRefusal = { role: string; code: "PLATFORM_ROLE" | "NOT_GRANTABLE" | "CALLER_LACKS_ROLE"; message: string };
export type GrantCheck = { ok: true; roles: string[] } | { ok: false; refused: GrantRefusal[] };

const STAFF = new Set<string>(STAFF_ROLES);
const ADMIN_TIER = new Set<string>(ADMIN_TIER_ROLES);
const PLATFORM = new Set<string>(PLATFORM_ROLES);

export function isTenantGrantable(role: string): boolean {
  return STAFF.has(role) || ADMIN_TIER.has(role);
}

/** Normalise a requested role list: trim, dedupe, keep order. Non-string / empty entries are kept as-is so they get refused, not silently dropped. */
export function normaliseRoles(roles: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of roles) {
    const v = typeof r === "string" ? r.trim() : String(r);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * May a caller holding `callerRoles` grant every role in `requested`? All-or-nothing: one refusal refuses the
 * whole request, so a partly-valid request can never be half-applied.
 */
export function checkGrant(callerRoles: readonly string[], requested: readonly string[]): GrantCheck {
  const roles = normaliseRoles(requested);
  const refused: GrantRefusal[] = [];
  const platformCaller = callerRoles.some((r) => (PLATFORM_CALLERS as readonly string[]).includes(r));
  for (const role of roles) {
    if (PLATFORM.has(role)) {
      refused.push({ role, code: "PLATFORM_ROLE", message: `${role} is a platform or tenant-governance role and cannot be granted through user create / role change` });
    } else if (!isTenantGrantable(role)) {
      refused.push({ role, code: "NOT_GRANTABLE", message: `${role} is not a tenant-grantable role` });
    } else if (ADMIN_TIER.has(role) && !platformCaller && !callerRoles.includes(role)) {
      refused.push({ role, code: "CALLER_LACKS_ROLE", message: `you cannot grant ${role} because you do not hold it yourself` });
    }
  }
  return refused.length > 0 ? { ok: false, refused } : { ok: true, roles };
}

/** Roles to assign at create: the request, or the default employee role when none were given. */
export function effectiveCreateRoles(requested: readonly string[] | undefined): string[] {
  const roles = normaliseRoles(requested ?? []);
  return roles.length > 0 ? roles : [DEFAULT_ROLE];
}

/** Roles every Keycloak user carries by construction; they say nothing about authority and are ignored when judging a user's roles. */
export function isBuiltinRealmRole(name: string): boolean {
  return name.startsWith("default-roles-") || name === "offline_access" || name === "uma_authorization";
}

/**
 * Could a caller holding `callerRoles` act for a user who holds `targetRoles`? True only if the caller could GRANT
 * every role the target holds (same tiers as the role-change route). A target with any role outside the allow-list
 * (tenant_admin, super_admin, ...) is therefore never reachable, and an admin-tier role the caller lacks blocks too.
 */
export function checkCanActFor(callerRoles: readonly string[], targetRoles: readonly string[]): GrantCheck {
  return checkGrant(callerRoles, targetRoles.filter((r) => !isBuiltinRealmRole(r)));
}

/** Allow-list only (no caller rule): used to vet a whole desired set before the caller rule is applied to what actually changes. */
export function checkAllowList(requested: readonly string[]): GrantCheck {
  const roles = normaliseRoles(requested);
  const refused: GrantRefusal[] = [];
  for (const role of roles) {
    if (PLATFORM.has(role)) refused.push({ role, code: "PLATFORM_ROLE", message: `${role} is a platform or tenant-governance role and cannot be granted through user create / role change` });
    else if (!isTenantGrantable(role)) refused.push({ role, code: "NOT_GRANTABLE", message: `${role} is not a tenant-grantable role` });
  }
  return refused.length > 0 ? { ok: false, refused } : { ok: true, roles };
}
