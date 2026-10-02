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

/** hrms-service device-trust admin routes (list/block/unblock/policy). */
export const DEVICE_ADMIN_ROLES = ["hr_admin", "it_admin", "super_admin"];

/** audit-service readers of the tenant audit event log (fallback copy for a 403). */
export const AUDIT_LOG_VIEW_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin"];
