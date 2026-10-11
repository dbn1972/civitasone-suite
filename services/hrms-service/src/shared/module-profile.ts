/**
 * HRMS module profile — the `HRMS_MODULES` allow-list.
 *
 * SmartTransfer OS M01 / ST-M01-04 (SMARTTRANSFER-MASTER-SPEC-v3 §3, §11;
 * D-ST-23 "Workforce Core as a licensable module profile of hrms-service").
 * See M00/standalone/STANDALONE-FEASIBILITY.md §4 (option a) and
 * _work/2-workforce-core.md §7 for the definition of "Workforce Core".
 *
 * WHY: hrms-service registers ~100 route plugins and ~57 consumers
 * unconditionally (app.ts / worker.ts). A SmartTransfer-standalone tenant that
 * licenses only "Workforce Core" must NOT boot leave, recruitment, payroll-
 * facing, attendance, claims, training, etc. This profile lets the service
 * register only the modules a deployment is licensed for, deciding it at the
 * SOURCE (routes/consumers never register) rather than only at the gateway.
 *
 * SCOPE / FUTURE: the allow-list is read from the `HRMS_MODULES` environment
 * variable TODAY (one value for the whole service process). Per-tenant module
 * enablement (composition.tenant_entitlement) is a LATER change — it needs a
 * request/message-scoped guard, not a boot-time registration switch, and is
 * out of scope for this row. This file is deliberately the single place that
 * encodes the core vs non-core taxonomy so a per-tenant layer can reuse it.
 *
 * SEMANTICS (no regression):
 *   • `HRMS_MODULES` UNSET  -> ALL modules register (today's behaviour).
 *   • `HRMS_MODULES=core`   -> only CORE modules register (Workforce Core).
 *   • `HRMS_MODULES=core,leave,payroll` (explicit CSV) -> CORE is always
 *     implied, plus the named non-core modules. Unknown names throw at boot
 *     (fail fast, never silently widen or narrow the surface).
 *
 * This module changes ONLY which hrms-service route plugins and consumers are
 * registered in THIS process. It does not touch the gateway module-guard and
 * does not change any fail-open / fail-closed semantics (owned by ST-M01-02,
 * blocked).
 */

/**
 * Non-core HRMS modules. Each is a licensable unit that the gateway can gate
 * with its own key once ST-M01-02 lands the fail-closed guard; here they are
 * the units the in-service allow-list switches on and off.
 *
 * CORE (Workforce Core) is intentionally NOT in this list: it is always
 * registered and cannot be switched off (see `isCoreAlwaysOn`).
 */
export const NON_CORE_MODULES = [
  "leave",
  "attendance",
  "recruitment",
  "appraisal",
  "payroll_facing", // pension, gpf, nps, cpf, pay-matrix, pay-profile, loans, claims, medical, benefits
  "training",
  "social",
  "disciplinary",
  "deputation",
  "contracts", // consultant/contractor/apprentice engagements
  "assessment",
  "id_cards",
  "device_trust",
  "ai", // ai-ml, ai-fraud, ai-predictions
  "rti",
  "gap_features",
  "workforce_planning",
  "board_intake",
  "competency",
  "self_service",
] as const;

export type NonCoreModule = (typeof NON_CORE_MODULES)[number];

const NON_CORE_SET = new Set<string>(NON_CORE_MODULES);

/** The literal that selects the Workforce-Core-only profile. */
export const CORE_PROFILE = "core";

export class ModuleProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleProfileError";
  }
}

/**
 * Parse `HRMS_MODULES` into the set of ENABLED non-core module keys. CORE is
 * always on and is not represented in the returned set.
 *
 * @param raw the raw env value (undefined / "" => all modules on).
 */
export function parseEnabledNonCore(raw: string | undefined): Set<string> {
  // Unset or blank: today's behaviour — every non-core module on.
  if (raw === undefined || raw.trim() === "") {
    return new Set<string>(NON_CORE_MODULES);
  }

  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  // Bare `core` (the canonical standalone value) => core only.
  const enabled = new Set<string>();
  for (const tok of tokens) {
    if (tok === CORE_PROFILE) continue; // core is always on; not a non-core key
    if (!NON_CORE_SET.has(tok)) {
      throw new ModuleProfileError(
        `HRMS_MODULES contains unknown module "${tok}". Known non-core modules: ${NON_CORE_MODULES.join(", ")}. ` +
          `Use "core" for Workforce-Core-only, or leave HRMS_MODULES unset for all modules.`,
      );
    }
    enabled.add(tok);
  }
  return enabled;
}

export interface ModuleProfile {
  /** The raw env value this profile was built from (for logging). */
  readonly raw: string | undefined;
  /** True when HRMS_MODULES was unset/blank (all modules on, no regression). */
  readonly allModules: boolean;
  /** True when the profile is Workforce-Core-only (no non-core modules). */
  readonly coreOnly: boolean;
  /** The enabled non-core module keys (empty => core only). */
  readonly enabledNonCore: ReadonlySet<string>;
  /** CORE is always registered; returns true for any core module. */
  isCoreAlwaysOn(): true;
  /** Whether a given non-core module key is enabled in this profile. */
  isNonCoreEnabled(moduleKey: NonCoreModule): boolean;
}

/** Build the profile for the current process from `HRMS_MODULES`. */
export function loadModuleProfile(raw: string | undefined = process.env.HRMS_MODULES): ModuleProfile {
  const enabledNonCore = parseEnabledNonCore(raw);
  const allModules = raw === undefined || raw.trim() === "";
  const coreOnly = !allModules && enabledNonCore.size === 0;
  return {
    raw,
    allModules,
    coreOnly,
    enabledNonCore,
    isCoreAlwaysOn: () => true as const,
    isNonCoreEnabled: (moduleKey: NonCoreModule) => enabledNonCore.has(moduleKey),
  };
}
