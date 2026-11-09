import { hasRoleFamily } from "@/lib/auth/roleGuard";
import { MODULE_REGISTRY } from "@/app/_data/moduleRegistry";
import { REPORTS_READER_ROLES } from "@/lib/auth/navRoles";

// UAT b23: modules whose destination layout admits an exact role list rather than a role family. The registry's
// family matcher cannot express these, and `roles: []` there means "everyone", so a plain employee was offered a
// Reports tile that reports/layout.tsx (requireAnyRole(REPORTS_READER_ROLES)) redirects away. Keyed by href.
const EXACT_ROLE_GATES: Record<string, readonly string[]> = {
  "/reports": REPORTS_READER_ROLES,
};

// Lives outside page.tsx: a Next.js page module may only export the page and
// route-config fields, so this helper cannot be exported from there.
export function visibleModules(roles: string[]) {
  if (roles.some((r) => r === "super_admin")) return MODULE_REGISTRY;
  // GAP-DASHBOARD-HOME-2-02: match on role FAMILY (exact or delimiter-prefixed),
  // not substring, so e.g. "chr_manager" no longer matches the "hr" family.
  // ux-001-ok: `m.roles` is a hardcoded property of the static MODULE_REGISTRY,
  // not fetched data — no loader/source in this path.
  return MODULE_REGISTRY.filter((m) => {
    const exact = EXACT_ROLE_GATES[m.href];
    if (exact) return roles.some((r) => exact.includes(r));
    return m.roles.length === 0 || m.roles.some((family) => hasRoleFamily(roles, family)); // ux-001-ok: static MODULE_REGISTRY, not fetched
  });
}
