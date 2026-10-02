/**
 * Who may grant/revoke which feature keys (role-features write path).
 *
 * Feature keys are `<module>.<capability>`. The prefixes below are the ONE list of
 * namespaces that confer authority over users, roles, tenant configuration,
 * subscriptions/billing or platform operations. A tenant_admin must not be able to
 * hand those out beyond their own authority; platform operators (platform_admin,
 * super_admin) are unrestricted. Ordinary module features (finance.*, hrms.*,
 * procurement.* ...) are not restricted.
 *
 * Derived from source:
 *  - identity-service rbac/domain.ts RESERVED_PREFIXES: "system.", "platform.", "rbac.admin"
 *  - the admin console catalogue: "admin.settings", "admin.users", admin.platform_config/plans/domains
 *  - tenant-service configuration surface: tenant.settings, tenant.users, tenant.subscriptions, tenant.tenant_configs
 *  - policy-service permission keys that edit roles/bindings/ABAC: policy.roles.write, policy.bindings.write, policy.abac_rules.write
 *  - identity / IAM / security namespaces, and billing.admin / billing.subscriptions / billing.plans
 * Matching is by lowercase startsWith, so "rbac." also covers "rbac.admin.x".
 */
export const RESTRICTED_FEATURE_PREFIXES = [
  "admin.",
  "platform.",
  "system.",
  "rbac.",
  "tenant.",
  "identity.",
  "iam.",
  "security.",
  "policy.",
  "billing.admin",
  "billing.subscriptions",
  "billing.plans",
] as const;
export const PLATFORM_CALLER_ROLES = ["platform_admin", "super_admin"] as const;

export function isPlatformFeature(featureKey: string): boolean {
  const k = featureKey.trim().toLowerCase();
  return RESTRICTED_FEATURE_PREFIXES.some((p) => k.startsWith(p));
}

export function isPlatformCaller(roles: readonly string[]): boolean {
  return PLATFORM_CALLER_ROLES.some((r) => roles.includes(r));
}

/**
 * Pure decision: platform callers may manage anything; everyone else may
 * manage a non-platform feature, or a platform feature only if one of their own
 * roles already holds it.
 */
export function mayManageFeature(roles: readonly string[], featureKey: string, heldByCaller: ReadonlySet<string>): boolean {
  if (isPlatformCaller(roles)) return true;
  if (!isPlatformFeature(featureKey)) return true;
  return heldByCaller.has(featureKey);
}
