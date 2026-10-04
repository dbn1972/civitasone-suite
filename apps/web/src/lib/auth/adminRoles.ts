/**
 * Role allow-lists for the /admin console pages. Each list mirrors the
 * backing service's own server-side gate (derive from source, not from the
 * catalogue) so a page never renders for a caller the API will reject. The
 * server remains the authority; these only give a clean redirect instead of a
 * page full of 403s.
 */

/** admin-service platform-only routes: operations, sa-dashboard, platform-config, scheduled-jobs, feature-flags. */
export const ADMIN_PLATFORM_ROLES = ["platform_admin", "super_admin"];

/**
 * Tenant-scoped admin routes: admin-service gap routes (users, roles,
 * permissions, user-roles, settings), integration-settings (TENANT_ADMIN_ROLES),
 * tenant-service org-hierarchy, policy-service role-features.
 */
export const ADMIN_TENANT_ROLES = ["tenant_admin", "platform_admin", "super_admin"];

/**
 * Platform integrations (e-Sign, DSC, bank API, PFMS), tenant side. Mirrors admin-service
 * modules/platform-integrations INTEGRATION_ROLES: tenant admins plus the module admins who
 * own signing and payments. Changing the production-approval policy stays tenant_admin only.
 */
export const INTEGRATION_ADMIN_ROLES = [...ADMIN_TENANT_ROLES, "finance_admin", "payroll_admin"];

/** hrms-service device-trust admin routes (list/block/unblock/policy). */
export const DEVICE_ADMIN_ROLES = ["hr_admin", "it_admin", "super_admin"];

/** audit-service readers of the tenant audit event log (fallback copy for a 403). */
export const AUDIT_LOG_VIEW_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin"];

// ── h4-admin-platform-tenancy: per-page platform-operator gates ──────────
// GAP-ADMIN-EDITIONS-01 / -ENTITLEMENTS-01 / -FEATURE-FLAGS-02 / -GATEWAY-CONFIG-03 /
// -GATEWAY-ROUTES-01 / -GATEWAYS-01 / -INVOICES-01 / -METERING-01 / -ONBOARDING-01 /
// -TECH-ADMIN-01 / -TENANTS-01 / -TENANTS-DETAIL-02 / -BULK-SCAN-01 / -DISCOVERY-01:
// these pages render PermissionDenied (via admin/_components/AdminAccessGate)
// before running any loader for a caller outside the backend's own guard.

/**
 * Platform operators. Mirrors admin-service shared/context.ts
 * requireSuperAdmin() (["super_admin", "platform_admin"]), the guard on
 * GET /v1/admin/tenants[/:id], /v1/admin/tenants/:id/config,
 * /v1/admin/sa-dashboard, /v1/admin/health/:service and
 * /v1/admin/platform-config/gateway, and feature-flags/routes.ts ADMIN_ROLES.
 */
/** Same list as ADMIN_PLATFORM_ROLES above (kept as the name the h4 platform pages import). */
export const PLATFORM_ADMIN_ROLES: readonly string[] = ADMIN_PLATFORM_ROLES;

/**
 * Readers of the gateway API catalogue. Mirrors gateway-service
 * catalogue/routes.ts ADMIN_ROLES (GAP-ADMIN-GATEWAY-ROUTES-01).
 */
export const API_CATALOGUE_ROLES: readonly string[] = [...PLATFORM_ADMIN_ROLES, "api_admin"];

/**
 * Readers of the caller-scoped invoice list. Mirrors billing-service
 * invoices/routes.ts BILLING_ROLES on GET /v1/billing/invoices.
 */
export const BILLING_INVOICE_READER_ROLES: readonly string[] = [
  "billing_admin",
  "tenant_admin",
  ...PLATFORM_ADMIN_ROLES,
];

/**
 * Who may record an offline payment, approve/reject one, send an invoice reminder or change billing
 * settings: PLATFORM staff only, like every other invoice write (billing-service requireSuperAdmin /
 * invoice-ops OPS_ROLES). billing_admin is a tenant-side role, so it only views.
 */
export const BILLING_INVOICE_OPERATOR_ROLES: readonly string[] = [...PLATFORM_ADMIN_ROLES];

/** True when any of `sessionRoles` is in `allowed`. Pure, so it is unit-testable without a request scope. */
export function rolesAllow(sessionRoles: readonly string[], allowed: readonly string[]): boolean {
  return sessionRoles.some((r) => allowed.includes(r));
}
