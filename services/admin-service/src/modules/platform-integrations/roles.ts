/**
 * platform-integrations — category-scoped roles.
 *
 * bank_api / pfms: finance and payroll own payments, so finance_admin and
 * payroll_admin join the tenant/platform admins. esign / dsc: tenant admins
 * and the platform roles only. Enforced in the route AND the consumer (the
 * route stamps the caller's roles into the command it publishes).
 */
import { TENANT_ADMIN_ROLES } from "../../shared/context.js";
import type { IntegrationCategory } from "./schema.js";

const PAYMENT_ROLES: string[] = [...TENANT_ADMIN_ROLES, "finance_admin", "payroll_admin"];
const SIGNING_ROLES: string[] = [...TENANT_ADMIN_ROLES];

/** Union of every category's roles: the coarse gate for category-agnostic routes. */
export const INTEGRATION_ROLES: string[] = PAYMENT_ROLES;
/** The per-tenant approval policy is a tenant-level decision. */
export const POLICY_ROLES: string[] = [...TENANT_ADMIN_ROLES];

export function rolesForCategory(category: IntegrationCategory): string[] {
  return category === "bank_api" || category === "pfms" ? PAYMENT_ROLES : SIGNING_ROLES;
}

export function canUseCategory(category: IntegrationCategory, roles: string[]): boolean {
  const allowed = rolesForCategory(category);
  return roles.some((r) => allowed.includes(r));
}
