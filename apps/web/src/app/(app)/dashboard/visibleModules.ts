import { hasRoleFamily } from "@/lib/auth/roleGuard";
import { MODULE_REGISTRY } from "@/app/_data/moduleRegistry";

// Lives outside page.tsx: a Next.js page module may only export the page and
// route-config fields, so this helper cannot be exported from there.
export function visibleModules(roles: string[]) {
  if (roles.some((r) => r === "super_admin")) return MODULE_REGISTRY;
  // GAP-DASHBOARD-HOME-2-02: match on role FAMILY (exact or delimiter-prefixed),
  // not substring, so e.g. "chr_manager" no longer matches the "hr" family.
  // ux-001-ok: `m.roles` is a hardcoded property of the static MODULE_REGISTRY,
  // not fetched data — no loader/source in this path.
  return MODULE_REGISTRY.filter(
    (m) => m.roles.length === 0 || m.roles.some((family) => hasRoleFamily(roles, family)), // ux-001-ok: static MODULE_REGISTRY, not fetched
  );
}
