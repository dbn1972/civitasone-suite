/**
 * GAP-PLATFORM-ADMIN-HOME-04: single source of human-readable role display
 * labels, shared by (app)/layout.tsx and anywhere that needs to show a role
 * key to a user. Unknown keys fall back to a humanised form of the key itself
 * (so a role that only exists in the backend catalogue still renders sensibly
 * rather than disappearing).
 *
 * This is display-only — authorisation decisions still use the raw role keys
 * via lib/auth/roleGuard. The real, authoritative list of platform roles is
 * the backend catalogue (getAdminRolesList); this map only prettifies the
 * keys for display and is NOT a source of truth for which roles exist.
 */
export const ROLE_DISPLAY_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  platform_admin: "Platform Admin",
  tenant_admin: "Tenant Admin",
  finance_admin: "Finance Admin",
  finance_staff: "Finance Staff",
  hr_admin: "HR Admin",
  hr_staff: "HR Staff",
  payroll_admin: "Payroll Admin",
  audit_admin: "Audit Admin",
  auditor: "Auditor",
  dept_head: "Department Head",
  procurement: "Procurement",
  viewer: "Viewer",
};

/** Humanise an unknown snake_case role key: "lead_officer" -> "Lead Officer". */
function humanizeRoleKey(key: string): string {
  return key
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Display label for a role key, falling back to a humanised key. */
export function roleDisplayLabel(key: string): string {
  return ROLE_DISPLAY_LABELS[key] ?? humanizeRoleKey(key);
}
