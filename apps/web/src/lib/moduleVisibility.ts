/**
 * One place to decide which modules a clerk's tenant has turned on. Used by the
 * help hub (and available to the sidebar and wizard) so multi-tenant scoping is
 * consistent. Requirement 13.
 *
 * Safety rule: when enablement data is unavailable, show everything rather than
 * hiding help due to a load error (matches the sidebar's backwards-compatible
 * behaviour). Requirement 13.1/13.2 are about hiding *disabled* modules, not
 * about hiding when we simply don't know.
 */
import { getNavModules } from "@/app/_data/loaders";

/**
 * Returns the set of enabled module keys for the current tenant, or null when it
 * could not be determined (caller should then show all). Sourced from the module
 * composition engine (dependency-resolved org profile, projected to gateway
 * route-keys). An un-onboarded tenant returns an empty list → null → show all,
 * so composition never blanks the nav for a tenant that predates onboarding.
 */
export async function getEnabledModules(): Promise<string[] | null> {
  const result = await getNavModules();
  if (result.source === "error") return null;
  const names = result.data.map((m) => m.name?.toLowerCase().trim()).filter(Boolean) as string[];
  return names.length > 0 ? names : null;
}

/**
 * True when a module should be visible. A null moduleKey is always visible
 * (platform/overview). A null enabled-list means "unknown" → show all.
 * Matching is lenient: a module is enabled if any enabled name contains, or is
 * contained by, the key (handles "hrms" vs "hr", "establishment" vs "estab").
 *
 * Super admins and platform admins bypass module gating entirely.
 */
export function isModuleEnabled(
  enabled: string[] | null,
  moduleKey: string | null,
  roles?: string[],
): boolean {
  if (moduleKey === null) return true;
  // Super admins and platform admins bypass module gating
  if (roles?.includes("super_admin") || roles?.includes("platform_admin")) return true;
  if (!enabled) return true; // unknown → show all
  const key = moduleKey.toLowerCase();
  return enabled.some((name) => name === key || name.includes(key) || key.includes(name));
}
