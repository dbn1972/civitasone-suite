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

/** Honest tri-state: we never guess "to do" when we couldn't check. (R8.4, R10.3) */
export type StepStatus = "complete" | "todo" | "unknown";

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
    entryHref: "/tenant-admin/settings",
  },
  {
    key: "branches",
    num: 2,
    icon: "📍",
    title: "Add your branch offices",
    explanation: "Add your head office first, then add branches under it. You can pick which office each branch reports to.",
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
    required: true,
    entryHref: "/hr/directory",
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
    entryHref: "/tenant-admin/settings",
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
    entryHref: "/hr/salary-structure",
    moduleKey: "hrms",
  },
];

/** The finishing/readiness step is reached when all required steps are complete. (R7.7) */
export const REQUIRED_STEP_KEYS = WIZARD_STEPS.filter((s) => s.required).map((s) => s.key);

/** Count of genuinely complete steps among the given keys. (R8.2) */
export function countComplete(statuses: Record<string, StepStatus>, keys: WizardStepKey[]): number {
  return keys.filter((k) => statuses[k] === "complete").length;
}

/** Progress percentage computed from completed steps only. (R8.2) */
export function progressPct(statuses: Record<string, StepStatus>, keys: WizardStepKey[]): number {
  if (keys.length === 0) return 0;
  return Math.round((countComplete(statuses, keys) / keys.length) * 100);
}

/** True when every required step is complete — enables the readiness state. (R7.7) */
export function allRequiredComplete(statuses: Record<string, StepStatus>): boolean {
  return REQUIRED_STEP_KEYS.every((k) => statuses[k] === "complete");
}

/** Index of the first step that is not complete, for resume-on-return. (R9.2) */
export function firstIncompleteIndex(steps: WizardStep[], statuses: Record<string, StepStatus>): number {
  const i = steps.findIndex((s) => statuses[s.key] !== "complete");
  return i === -1 ? 0 : i;
}
