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
 * M2 (module-sale gap): the HR area is THREE separately licensable switches.
 *
 *   hrms        HR core (employees, attendance, leave, appraisal, learning ...)
 *   payroll     Payroll (/hr/payroll/*, payslips, pay group on the employee page)
 *   recruitment Recruitment (/hr/recruitment, JD templates)
 *
 * A screen asks `isModuleEnabled(list, "payroll")` etc. The tenant list is the
 * composition projection of gateway route-keys (GET /v1/admin/composition/
 * my-modules) OR, for legacy tenants, the config.admin_module_configs names.
 * Which list entries turn each switch on is this ONE table, matched EXACTLY
 * (no prefix / substring / contains matching - that is what used to turn
 * neighbours on: "hrms-payroll" enabled Payroll, "hrms-contracts" enabled
 * Contracts, "hrms" enabled "hr", ...).
 *
 *   entry in the tenant list        HR   Payroll  Recruitment
 *   ------------------------------  ---  -------  -----------
 *   hrms   (legacy blanket key)     on   on       on     <- compat rule: one
 *   hr     (legacy alias of hrms)   on   on       on        blanket switch keeps
 *                                                            showing all three
 *   workforce_core                  -    -        -   <- Workforce Core alone (the
 *                                                         SmartTransfer standalone SKU)
 *                                                         has never opened the /hr area
 *                                                         (ST-M01-04b); `employee`
 *                                                         always also projects hrms-*
 *                                                         sub-keys, so HRIS tenants are on
 *   hrms-leave / -attendance /      on   -        -
 *     -appraisal / -self-service /
 *     -training / -social /
 *     -disciplinary / -deputation /
 *     -contracts / -assessment /
 *     -id-cards / -ai / -rti /
 *     -workforce-planning /
 *     -board-intake / -competency
 *   payroll                         -    on       -
 *   hrms-recruitment                -    -        on
 *   hrms-payroll                    -    -        -   <- NOT the Payroll switch:
 *                                                         composition module
 *                                                         `employee` projects it
 *                                                         for tenants WITHOUT
 *                                                         Payroll
 */
export const HR_SWITCH = "hrms";
export const PAYROLL_SWITCH = "payroll";
export const RECRUITMENT_SWITCH = "recruitment";

/** Legacy blanket keys: one switch for the whole HR area (compat rule, not a substring match). */
const LEGACY_HR_BLANKET: readonly string[] = ["hrms", "hr"];

/** Entries that turn each HR-area switch on. Exact match only. Exported for the tests and docs. */
export const SWITCH_ENABLERS: Readonly<Record<string, readonly string[]>> = {
  [HR_SWITCH]: [
    ...LEGACY_HR_BLANKET,
    "hrms-leave",
    "hrms-attendance",
    "hrms-appraisal",
    "hrms-self-service",
    "hrms-training",
    "hrms-social",
    "hrms-disciplinary",
    "hrms-deputation",
    "hrms-contracts",
    "hrms-assessment",
    "hrms-id-cards",
    "hrms-ai",
    "hrms-rti",
    "hrms-workforce-planning",
    "hrms-board-intake",
    "hrms-competency",
  ],
  [PAYROLL_SWITCH]: [...LEGACY_HR_BLANKET, "payroll"],
  [RECRUITMENT_SWITCH]: [...LEGACY_HR_BLANKET, "hrms-recruitment"],
};

/** Screen keys that are spellings of a switch ("hr" is the old spelling of the HR switch). */
const SWITCH_KEY_ALIASES: Readonly<Record<string, string>> = { hr: HR_SWITCH };

/**
 * Exact-match aliases for every other module key: key -> extra list entries that
 * also enable it. Express renames / singular-plural pairs here, never by substring.
 *   estab <-> establishment   (route name vs gateway key)
 *   recommendation(s), journey(s)   (singular / plural spellings, GAP-*-HOME)
 *   revenue -> finance        (composition projects revenue to the finance key)
 */
export const MODULE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  estab: ["establishment"],
  establishment: ["estab"],
  recommendation: ["recommendations"],
  recommendations: ["recommendation"],
  journey: ["journeys"],
  journeys: ["journey"],
  revenue: ["finance"],
};

export type ModuleSwitches = { hr: boolean; payroll: boolean; recruitment: boolean };

/**
 * True when a module should be visible. A null moduleKey is always visible
 * (platform/overview). A null enabled-list means "unknown" -> show all.
 * Matching is EXACT: a list entry equal to the key, an entry in the key's alias
 * table, or (for the three HR-area switches) an entry in SWITCH_ENABLERS.
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
  // composition (mirrors the gateway's PLATFORM_ROUTES). Additive - can only
  // ENABLE visibility. The Sidebar passes platformAlwaysOn:false: it has always
  // listed a platform entry (Documents, Workflow) only when the tenant list names it.
  if (opts.platformAlwaysOn !== false && PLATFORM_MODULE_KEYS.has(key)) return true;
  if (!enabled) return true; // unknown -> show all
  const switchKey = SWITCH_KEY_ALIASES[key] ?? key;
  const enablers = SWITCH_ENABLERS[switchKey];
  if (enablers) return enabled.some((name) => enablers.includes(name));
  const aliases = MODULE_ALIASES[key] ?? [];
  return enabled.some((name) => name === key || aliases.includes(name));
}

/** The three HR-area switches for a tenant list (same rules as isModuleEnabled). */
export function moduleSwitches(enabled: string[] | null, roles?: readonly string[]): ModuleSwitches {
  return {
    hr: isModuleEnabled(enabled, HR_SWITCH, roles),
    payroll: isModuleEnabled(enabled, PAYROLL_SWITCH, roles),
    recruitment: isModuleEnabled(enabled, RECRUITMENT_SWITCH, roles),
  };
}

/**
 * Which switch gates an /hr/... tile or route. Payroll and Recruitment screens
 * hide when their switch is off; every other HR path follows the HR switch.
 */
export function hrAreaSwitchForHref(href: string): string {
  if (href === "/hr/payroll" || href.startsWith("/hr/payroll/")) return PAYROLL_SWITCH;
  if (href === "/hr/recruitment" || href.startsWith("/hr/recruitment/") || href === "/hr/jd-templates" || href.startsWith("/hr/jd-templates/"))
    return RECRUITMENT_SWITCH;
  return HR_SWITCH;
}
