/**
 * Pure module-enablement matching, shared by the server (ModuleGate, help hub)
 * and the client (Sidebar, global-search page index). It lives apart from
 * moduleVisibility.ts because that file imports the data loaders, which a
 * "use client" component must not pull in. moduleVisibility.ts re-exports
 * everything here, so existing imports are unchanged.
 *
 * UAT-P3 (UX shell, S-02 / NAV-02): the Sidebar used an exact Set lookup of
 * the moduleKey while every module layout (ModuleGate) used this lenient
 * matcher. The composition projection emits gateway keys such as
 * "hrms-payroll" / "hrms-leave" (never the bare "hrms"), so HR & Payroll and
 * Learning were hidden from the sidebar while their pages opened fine, and
 * the super_admin bypass ModuleGate applies was missing too.
 */

/**
 * Platform module keys that are ALWAYS visible, in every tenant composition
 * (ST-M01-02). Mirrors the gateway's PLATFORM_ROUTES and the standalone platform
 * layer (SMARTTRANSFER-MASTER-SPEC-v3 §1). Exported for the parity test.
 */
export const PLATFORM_MODULE_KEYS = new Set([
  "identity",
  "admin",
  "audit",
  "notification",
  "workflow",
  "documents",
  "eoffice",
  "policy",
  "queue",
  "tenant",
]);

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
  roles?: readonly string[],
  opts: { platformAlwaysOn?: boolean } = {},
): boolean {
  if (moduleKey === null) return true;
  // Super admins and platform admins bypass module gating
  if (roles?.includes("super_admin") || roles?.includes("platform_admin")) return true;
  const key = moduleKey.toLowerCase();
  // ST-M01-02: platform module keys are ALWAYS visible, in every tenant
  // composition. These mirror the gateway's PLATFORM_ROUTES
  // (services/gateway-service/src/module-guard.ts) and the standalone platform
  // layer (SMARTTRANSFER-MASTER-SPEC-v3 §1: identity, admin, audit, notification,
  // workflow, DOCUMENT/eOffice, queue, policy, tenant). The gateway lets these
  // through in enforce mode as platform routes; the web nav/ModuleGate must
  // agree, or a composed/standalone tenant whose projection omits "documents"
  // would hide a platform screen the API happily serves. Additive — can only
  // ENABLE visibility, never hide a module.
  // The Sidebar passes platformAlwaysOn:false: it has always listed a platform
  // entry (Documents, Workflow) only when the tenant list names it.
  if (opts.platformAlwaysOn !== false && PLATFORM_MODULE_KEYS.has(key)) return true;
  if (!enabled) return true; // unknown → show all
  // GAP-RECOMMENDATIONS-HOME-04: the recommendations route/nav gate on the key
  // "recommendation" (singular) while a tenant's entitlement flag may be named
  // either "recommendation" or "recommendations". The existing bidirectional
  // substring match below already resolves this (one contains the other), but
  // only incidentally; this explicit alias pair makes the singular/plural
  // equivalence a deliberate, tested contract rather than relying on `includes`
  // happening to line up. It is strictly additive — it can only ENABLE a match
  // (never hide a module), so no tenant with a legacy flag name is affected, and
  // the lenient fallback for every other module is left untouched.
  const RECOMMENDATION_ALIASES = new Set(["recommendation", "recommendations"]);
  if (RECOMMENDATION_ALIASES.has(key)) {
    if (enabled.some((name) => RECOMMENDATION_ALIASES.has(name))) return true;
  }
  // GAP-JOURNEYS-HOME-03: the journeys route/nav use moduleKey "journey" while
  // a tenant flag may be registered as the plural "journeys" (or vice versa).
  // The lenient contains-match below already resolves this pair, but it is
  // ambiguous (it would also match on any shared substring). Pin the intended
  // singular/plural equivalences explicitly so the decision is recorded and
  // cannot silently change if the fallback is ever tightened. This is additive:
  // the existing lenient fallback is unchanged, so no other module's gating
  // (e.g. "hrms" ⊇ "hr", "establishment"/"estab") is affected.
  const MODULE_ALIASES: Record<string, string[]> = {
    journey: ["journeys"],
    journeys: ["journey"],
    // UAT-P3 (S-02): admin-service composition/gateway-map.ts projects the
    // "revenue" composition module to the "finance" gateway key (there is no
    // "revenue" gateway key), so a composed tenant with revenue switched on
    // never carried "revenue" and the module stayed hidden. Additive only.
    revenue: ["finance"],
  };
  const aliases = MODULE_ALIASES[key] ?? [];
  if (enabled.some((name) => name === key || aliases.includes(name))) return true;
  return enabled.some((name) => name === key || name.includes(key) || key.includes(name));
}
