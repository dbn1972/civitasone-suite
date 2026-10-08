/**
 * The ordered model for the first-run organisation Bootstrap Wizard.
 *
 * This is pure data: the ordered steps, their plain-language copy, a concrete
 * example for each, whether they're required, where the clerk goes to do them,
 * and (for module-dependent steps) which module they belong to. Completion is
 * computed separately from real tenant data in `progress.ts` — never stored here.
 * Requirements 7 and 13.3.
 */

export type WizardStepKey =
  | "org-profile"
  | "branches"
  | "departments"
  | "people"
  | "modules"
  | "finance-year-coa"
  | "leave-policies"
  | "pay-structure";

/** Honest tri-state plus an explicit per-tenant deferral. (R8.4, R10.3)
 *
 * GAP-SETUP-HOME-02: "skipped" is a persisted per-tenant deferral of an
 * OPTIONAL step (stored in tenant-service settings under `setup.skipped_steps`).
 * It is distinct from "todo": a skipped step is excluded from the resume target
 * and from the progress denominator, but stays openable and un-skippable. A
 * required step is never skippable, so it can never be "skipped".
 */
export type StepStatus = "complete" | "todo" | "unknown" | "skipped";

/** The tenant-settings key that stores the array of skipped (deferred) step keys. */
export const SETUP_SKIPPED_STEPS_KEY = "setup.skipped_steps";

export type WizardStep = {
  key: WizardStepKey;
  num: number;
  icon: string;
  /** Plain-language title. (R7.2) */
  title: string;
  /** Plain-language explanation of the step's purpose. (R7.2) */
  explanation: string;
  /** A concrete example of valid input, shown beside the action. (R7.2, R7.8) */
  example: string;
  /** Label for the primary action. */
  cta: string;
  /** Whether the clerk must complete this to finish. false → skip/do-later offered. (R7.5) */
  required: boolean;
  /**
   * Where the clerk does the work. The wizard appends ?return=/setup so a focused
   * guided entry screen can send them back here afterwards. (R7.3)
   */
  entryHref: string;
  /** Module key when the step only applies to an enabled module. (R13.3) */
  moduleKey?: string;
};

/** The eight ordered setup areas required by Requirement 7.4. */
export const WIZARD_STEPS: WizardStep[] = [
  {
    key: "org-profile",
    num: 1,
    icon: "🏢",
    title: "Tell us about your office",
    explanation: "Add your office name, address, and a few basic details so everything is labelled correctly.",
    example: "e.g. District Industries Centre, Bhubaneswar",
    cta: "Add office details",
    required: true,
    // GAP-SETUP-HOME-04: distinct from the modules step (step 5) so returning
    // from the office-profile editor lands on its own section, not the module
    // toggles. The org profile is edited on the dedicated org-type screen.
    entryHref: "/tenant-admin/org-type",
  },
  {
    key: "branches",
    num: 2,
    icon: "📍",
    // GAP-SETUP-HOME-03: completion is >=1 location, so a single head office
    // satisfies the step. Word the title to match that rule honestly rather
    // than implying multiple branch offices are required.
    title: "Add your head office",
    explanation: "Add your head office first, then add any branches under it. You can pick which office each branch reports to.",
    example: "e.g. Head Office → Bhubaneswar Branch, Cuttack Branch",
    cta: "Add offices",
    required: true,
    entryHref: "/locations/list",
  },
  {
    key: "departments",
    num: 3,
    icon: "🗂️",
    title: "Set up departments",
    explanation: "Create the teams in your office so you can sort people and work by department.",
    example: "e.g. Finance, HR, Establishment",
    cta: "Add departments",
    // GAP-SETUP-HOME-01: departments live in the HRMS module, so this step must
    // be scoped to it — otherwise a tenant with HR off can never complete a
    // required step and allRequiredComplete() can never return true.
    required: true,
    // GAP-SETUP-HOME-04: send the clerk to the real departments management
    // screen (which creates departments) rather than the people directory.
    entryHref: "/hr/departments",
    moduleKey: "hrms",
  },
  {
    key: "people",
    num: 4,
    icon: "👋",
    title: "Invite your team",
    explanation: "Add the people who will use the system and choose what each person can do.",
    example: "e.g. Invite a clerk to enter bills, an officer to approve them",
    cta: "Invite people",
    required: true,
    entryHref: "/tenant-admin/users",
  },
  {
    key: "modules",
    num: 5,
    icon: "🧩",
    title: "Choose the parts you use",
    explanation: "Turn on only the parts you use — Finance, HR, Procurement. You can change this any time.",
    example: "e.g. Turn on Finance and HR, leave the rest off for now",
    cta: "Choose modules",
    required: true,
    // GAP-SETUP-HOME-04: anchor the module toggles section so this is a
    // distinct destination from the office-profile step (step 1).
    entryHref: "/tenant-admin/settings#modules",
  },
  {
    key: "finance-year-coa",
    num: 6,
    icon: "📒",
    title: "Set your financial year and accounts",
    explanation: "Pick the financial year you're working in and set up the list of account heads money is recorded against.",
    example: "e.g. Financial year 2026–27, with standard account heads",
    cta: "Set up accounts",
    required: false,
    entryHref: "/finance/chart-of-accounts",
    moduleKey: "finance",
  },
  {
    key: "leave-policies",
    num: 7,
    icon: "🌴",
    title: "Set up leave rules",
    explanation: "Decide the kinds of leave and how many days each person gets, so leave requests work correctly.",
    example: "e.g. Casual Leave 12 days, Earned Leave 30 days",
    cta: "Add leave rules",
    required: false,
    entryHref: "/hr/leave-policies",
    moduleKey: "hrms",
  },
  {
    key: "pay-structure",
    num: 8,
    icon: "💰",
    title: "Set up pay structure",
    explanation: "Set the salary parts (basic, allowances, deductions) so payroll can be run correctly.",
    example: "e.g. Basic pay, HRA, and standard deductions",
    cta: "Set up pay",
    required: false,
    entryHref: "/hr/payroll/structures",
    moduleKey: "hrms",
  },
];

/** The finishing/readiness step is reached when all required steps are complete. (R7.7) */
export const REQUIRED_STEP_KEYS = WIZARD_STEPS.filter((s) => s.required).map((s) => s.key);

/** Count of genuinely complete steps among the given keys. (R8.2) */
export function countComplete(statuses: Record<string, StepStatus>, keys: WizardStepKey[]): number {
  return keys.filter((k) => statuses[k] === "complete").length;
}

/**
 * GAP-SETUP-HOME-02: progress is computed over the steps that still COUNT —
 * i.e. every step except ones the tenant explicitly skipped. A skipped
 * optional step is neither "done" nor still "to do"; counting it in the
 * denominator would keep progress below 100% forever even though the office is
 * ready. Required steps are never skippable, so they always count.
 */
export function countableKeys(statuses: Record<string, StepStatus>, keys: WizardStepKey[]): WizardStepKey[] {
  return keys.filter((k) => statuses[k] !== "skipped");
}

/** Progress percentage computed from completed steps over the non-skipped denominator. (R8.2) */
export function progressPct(statuses: Record<string, StepStatus>, keys: WizardStepKey[]): number {
  const denom = countableKeys(statuses, keys);
  if (denom.length === 0) return 0;
  return Math.round((countComplete(statuses, denom) / denom.length) * 100);
}

/** True when every required step is complete — enables the readiness state. (R7.7)
 *
 * GAP-SETUP-HOME-01: readiness is evaluated over the steps actually VISIBLE to
 * the tenant. Module-scoped required steps (e.g. departments when HRMS is off)
 * are filtered out upstream, so checking the static REQUIRED_STEP_KEYS would
 * demand completion of a step the tenant can never see — leaving the ready card
 * permanently unreachable. Pass the visible steps so only shown required steps
 * gate readiness. Called with no steps it falls back to the full step list.
 */
export function allRequiredComplete(
  statuses: Record<string, StepStatus>,
  visibleSteps: WizardStep[] = WIZARD_STEPS,
): boolean {
  const requiredVisible = visibleSteps.filter((s) => s.required).map((s) => s.key);
  if (requiredVisible.length === 0) return false;
  return requiredVisible.every((k) => statuses[k] === "complete");
}

/** Index of the first step that is not complete AND not skipped, for
 * resume-on-return. (R9.2)
 *
 * GAP-SETUP-HOME-02: a skipped step is no longer the resume target — the
 * wizard resumes at the next step the tenant has neither finished nor
 * explicitly deferred, so "Skip for now" on step 6 moves the focus past it.
 * Falls back to 0 when every step is complete or skipped.
 */
export function firstIncompleteIndex(steps: WizardStep[], statuses: Record<string, StepStatus>): number {
  const i = steps.findIndex((s) => statuses[s.key] !== "complete" && statuses[s.key] !== "skipped");
  return i === -1 ? 0 : i;
}

/**
 * GAP-SETUP-HOME-02: fold the persisted skipped-step keys into the computed
 * statuses. Only OPTIONAL, not-yet-complete steps may be marked skipped: a
 * required step is never deferrable, and a step the tenant has since completed
 * must read "complete", not "skipped" (so finishing a skipped step clears the
 * deferral visually without needing a settings write).
 */
export function applySkippedSteps(
  statuses: Record<string, StepStatus>,
  steps: WizardStep[],
  skippedKeys: readonly string[],
): Record<string, StepStatus> {
  const skip = new Set(skippedKeys);
  const next: Record<string, StepStatus> = { ...statuses };
  for (const step of steps) {
    if (!skip.has(step.key)) continue;
    if (step.required) continue;
    if (next[step.key] === "complete") continue;
    next[step.key] = "skipped";
  }
  return next;
}
