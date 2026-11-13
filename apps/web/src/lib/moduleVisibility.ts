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
import { moduleSwitches, type ModuleSwitches } from "./moduleMatch";

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
 * The three HR-area switches (HR, Payroll, Recruitment) for the current tenant.
 * Unknown list (load error / un-onboarded tenant) -> all three on, so with
 * Payroll on or the list unknown behaviour is unchanged. Server-side only.
 */
export async function getModuleSwitches(roles?: readonly string[]): Promise<ModuleSwitches> {
  return moduleSwitches(await getEnabledModules(), roles);
}

export {
  PLATFORM_MODULE_KEYS,
  isModuleEnabled,
  moduleSwitches,
  hrAreaSwitchForHref,
  HR_SWITCH,
  PAYROLL_SWITCH,
  RECRUITMENT_SWITCH,
} from "./moduleMatch";
export type { ModuleSwitches } from "./moduleMatch";
