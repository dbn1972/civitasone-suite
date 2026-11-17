/**
 * Tenant-type profile catalogue (design: docs/design/TENANT-PROFILE-SWITCH.md).
 *
 * Pure and dependency-free: the profile DEFINITIONS are code, the profile ASSIGNMENT is tenant.tenants.profile_code
 * (tenant-service). Every service materialises the settings it owns into its own tables, so a posting path never
 * calls another service to learn the profile.
 *
 * Everything is gated by TENANT_PROFILES_ENABLED (default off). With the flag off, or for a profile that is not
 * `active`, effectiveSettings() returns LEGACY_SETTINGS: exactly what every tenant had before this feature.
 */

export const EDITIONS = ["govt", "psu", "private", "ngo", "section8", "cooperative", "small_office"] as const;
export type Edition = (typeof EDITIONS)[number];

export const BUDGET_CONTROLS = ["mandatory", "advisory", "off"] as const;
export type BudgetControl = (typeof BUDGET_CONTROLS)[number];

export const COA_TEMPLATES = ["govt", "commercial", "nonprofit"] as const;
export type CoaTemplate = (typeof COA_TEMPLATES)[number];

export const ACCOUNTING_BASES = ["cash", "accrual"] as const;
export type AccountingBasis = (typeof ACCOUNTING_BASES)[number];

/**
 * Admin-service directory edition strings (admin tenants.admin_tenants.edition / config.admin_editions.edition).
 * tenant-service edition `govt` is the admin edition `govt_dept`; every other edition is the same word.
 */
export const ADMIN_EDITIONS = ["govt_dept", "psu", "small_office", "private", "ngo", "section8", "cooperative"] as const;
export type AdminEdition = (typeof ADMIN_EDITIONS)[number];

/** Recruitment sourcing rule carried by the profile (consumed by hrms-service in slice B6). */
export const RECRUITMENT_POLICIES = ["requisition_first", "direct"] as const;
export type RecruitmentPolicy = (typeof RECRUITMENT_POLICIES)[number];

/** Screen-manifest family the gateway serves for this profile (consumed by gateway-service in slice B6). */
export const MANIFEST_KEYS = ["default", "msme"] as const;
export type ManifestKey = (typeof MANIFEST_KEYS)[number];

export type StatutoryPack = "govt_in" | "commercial_in" | "nonprofit_in";

/** Bumped whenever a profile definition changes; carried on tenant events as `profileVersion`. */
export const PROFILE_CATALOGUE_VERSION = "1";

export type ProfileSettings = {
  accountingBasis: AccountingBasis;
  budgetControl: BudgetControl;
  coaTemplate: CoaTemplate;
  /** Extra head packs seeded on top of the template (S4), e.g. "office-pack". */
  coaPacks: readonly string[];
  statutoryPack: StatutoryPack;
};

export type ProfileDef = {
  code: string;
  label: string;
  family: "govt" | "commercial" | "nonprofit";
  /** Editions that may carry this profile. */
  editions: readonly Edition[];
  /** false = placeholder: intended values are recorded, but the tenant behaves as LEGACY_SETTINGS. */
  active: boolean;
  /** Owner decision 4 (2026-11-06): a profile with no default bill head makes the setup wizard choose a major head. */
  defaultBillHead: "fixed" | "wizard";
  /** Composition bundle / org_profile code in admin-service. */
  bundleCode: string;
  /**
   * true = admin-service composes this profile's module bundle when the tenant is onboarded (flag on). An allow-list
   * driven by data: a new profile composes nothing until it is explicitly set true here.
   */
  composeOnOnboard: boolean;
  /** The admin directory edition string a tenant of this profile is stored under. */
  adminEdition: AdminEdition;
  recruitmentPolicy: RecruitmentPolicy;
  manifestKey: ManifestKey;
  settings: ProfileSettings;
};

/** What every tenant had before the profile switch (Indian government accounts). */
export const LEGACY_SETTINGS: ProfileSettings = Object.freeze({
  accountingBasis: "cash",
  budgetControl: "mandatory",
  coaTemplate: "govt",
  coaPacks: Object.freeze([]) as readonly string[],
  statutoryPack: "govt_in",
});

const GOVT: ProfileSettings = LEGACY_SETTINGS;

const legacyPlaceholder = (
  code: string, label: string, edition: Edition, adminEdition: AdminEdition, composeOnOnboard: boolean,
): ProfileDef => ({
  code, label, family: "govt", editions: [edition], active: false, defaultBillHead: "fixed", bundleCode: code,
  composeOnOnboard, adminEdition, recruitmentPolicy: "direct", manifestKey: "default", settings: GOVT,
});

export const PROFILES: readonly ProfileDef[] = Object.freeze([
  { code: "govt_dept", label: "Government department", family: "govt", editions: ["govt"], active: true, defaultBillHead: "fixed", bundleCode: "govt_dept",
    composeOnOnboard: false, adminEdition: "govt_dept", recruitmentPolicy: "requisition_first", manifestKey: "default", settings: GOVT },
  {
    code: "govt_small_office", label: "Small government office", family: "govt", editions: ["govt"], active: true, defaultBillHead: "wizard",
    bundleCode: "govt_small_office",
    // B2: admin migration 0064 seeds the govt_small_office org_profile + bundle (17 modules), composed in shadow mode.
    composeOnOnboard: true, adminEdition: "govt_dept", recruitmentPolicy: "requisition_first", manifestKey: "default",
    // Owner decision 1 (2026-11-06): budget control is mandatory from day one.
    settings: { ...GOVT, coaPacks: ["office-pack"] },
  },
  legacyPlaceholder("psu", "PSU / Board", "psu", "psu", true),
  legacyPlaceholder("private", "Private company", "private", "private", false),
  legacyPlaceholder("ngo", "NGO / Trust / Society", "ngo", "ngo", false),
  legacyPlaceholder("cooperative", "Cooperative society", "cooperative", "cooperative", false),
  {
    // Edition small_office is the MSME self-signup edition (tenant-service msme-onboard), not a government office.
    code: "small_office", label: "Small business / MSME", family: "commercial", editions: ["small_office"], active: false,
    defaultBillHead: "fixed", bundleCode: "small_office",
    composeOnOnboard: true, adminEdition: "small_office", recruitmentPolicy: "direct", manifestKey: "msme",
    settings: { accountingBasis: "accrual", budgetControl: "advisory", coaTemplate: "commercial", coaPacks: [], statutoryPack: "commercial_in" },
  },
  {
    code: "section8", label: "Section 8 company", family: "nonprofit", editions: ["section8"], active: false,
    defaultBillHead: "fixed", bundleCode: "section8",
    composeOnOnboard: true, adminEdition: "section8", recruitmentPolicy: "direct", manifestKey: "default",
    settings: { accountingBasis: "accrual", budgetControl: "advisory", coaTemplate: "nonprofit", coaPacks: [], statutoryPack: "nonprofit_in" },
  },
] satisfies ProfileDef[]);

const BY_CODE = new Map(PROFILES.map((p) => [p.code, p]));

/** The profile an edition gets when none is chosen. `govt` -> govt_dept, every other edition -> the same word. */
export function defaultProfileCode(edition: string): string {
  return edition === "govt" ? "govt_dept" : edition;
}

export function getProfile(code: string | null | undefined): ProfileDef | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

/**
 * The admin directory edition for a tenant-service edition (`govt` -> `govt_dept`, otherwise the same word), read from
 * the catalogue. An edition the catalogue does not know passes through unchanged (the admin DB CHECK then rejects it).
 */
export function adminEditionFor(edition: string): string {
  return getProfile(defaultProfileCode(edition))?.adminEdition ?? edition;
}

/** Whether admin-service composes this profile's bundle at onboard. Unknown / absent profile -> false (allow-list). */
export function composesOnOnboard(profileCode: string | null | undefined): boolean {
  return getProfile(profileCode)?.composeOnOnboard === true;
}

export function isProfileAllowedForEdition(profileCode: string, edition: string): boolean {
  const p = BY_CODE.get(profileCode);
  return !!p && (p.editions as readonly string[]).includes(edition);
}

/** TENANT_PROFILES_ENABLED === "true" (default off: UAT behaviour is unchanged until the owner turns it on). */
export function tenantProfilesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TENANT_PROFILES_ENABLED === "true";
}

/**
 * The settings a tenant of this profile starts with. Flag off, unknown code or a placeholder profile resolve to
 * LEGACY_SETTINGS, so an unknown or absent profile can never loosen a control.
 */
export function effectiveSettings(profileCode: string | null | undefined, flagOn: boolean = tenantProfilesEnabled()): ProfileSettings {
  const p = getProfile(profileCode);
  return flagOn && p && p.active ? p.settings : LEGACY_SETTINGS;
}

/** The read-API block: what GET /v1/tenants/:id returns under `profile`. */
export function describeProfile(profileCode: string | null | undefined, flagOn: boolean = tenantProfilesEnabled()) {
  const p = getProfile(profileCode);
  return {
    code: p?.code ?? profileCode ?? null,
    label: p?.label ?? null,
    active: !!p?.active && flagOn,
    version: PROFILE_CATALOGUE_VERSION,
    defaultBillHead: p?.defaultBillHead ?? "fixed",
    settings: effectiveSettings(profileCode, flagOn),
  };
}
