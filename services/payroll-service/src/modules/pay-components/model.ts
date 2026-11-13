/**
 * Section 8 gap G2: the pay-component CONTRACT. This is the one module the G1 CTC engine (and the web
 * admin screen, which mirrors these constants in apps/web/src/lib/payComponents.ts) builds on.
 * Docs: docs/design/S8-G2-COMPONENTS.md.
 *
 * Pure: no I/O. Everything here is data classification, never a statutory figure.
 */

/** Feature flag. Default OFF: only the exact string "true" turns the new write paths and fields on. */
export const PAY_COMPONENTS_FLAG = "S8_PAY_COMPONENTS_ENABLED";
export function payComponentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[PAY_COMPONENTS_FLAG] === "true";
}

/** run = the one structure a payroll run reads (every structure today); ctc_template = G1 CTC salary template. */
export const STRUCTURE_KINDS = ["run", "ctc_template"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

/** Owner decision 1 (10 Nov 2026): how a component's monthly amount is derived. */
export const COMPONENT_CALC_TYPES = ["pct_of_ctc", "pct_of_basic", "fixed", "balancing"] as const;
export type ComponentCalcType = (typeof COMPONENT_CALC_TYPES)[number];

/**
 * Employer-cost classification (owner decision 1). A component with a class is an employer cost, not an
 * employee earning. employer_pf and employer_esi are derived from the effective-dated statutory config
 * by the engine, so they carry no calc and no amount; the others carry a calc like any component.
 */
export const EMPLOYER_COST_CLASSES = ["employer_pf", "employer_esi", "gratuity_provision", "group_insurance", "other_employer"] as const;
export type EmployerCostClass = (typeof EMPLOYER_COST_CLASSES)[number];
/** Classes whose amount the engine derives from statutory config (no calc / amount on the row). */
export const STATUTORY_DERIVED_CLASSES: readonly EmployerCostClass[] = ["employer_pf", "employer_esi"];

/** Owner decision 1: per-template switch, employer cost sits inside CTC or on top of it. */
export const COST_PLACEMENTS = ["inside_ctc", "on_top"] as const;
export type CostPlacement = (typeof COST_PLACEMENTS)[number];

export const COMPONENT_TYPES = ["earning", "deduction", "employer_cost"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/** What the payroll engine honours today on a `run` structure (domain.ts rawComponentAmountMinor). */
export const RUN_CALC_TYPES: readonly ComponentCalcType[] = ["fixed", "pct_of_basic"];
/** The engine computes these itself and skips a structure row with these codes (domain.ts). */
export const RESERVED_RUN_CODES = ["BASIC", "DA", "HRA"] as const;

export const COMPONENT_CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
/** Largest fixed amount accepted (paise): Rs 100 crore a month, a sanity bound, not a statutory figure. */
export const MAX_FIXED_MINOR = 10_000_000_000_000n;

/** The write-side shape of one component (what a create / update resolves to). */
export interface ComponentSpec {
  code: string;
  name: string;
  componentType: ComponentType;
  isTaxable: boolean;
  calc: ComponentCalcType | null;
  /** percent of basic, 0..100, at most 2 decimals; null unless calc = pct_of_basic */
  pctOfBasic: number | null;
  /** percent of monthly fixed CTC in basis points 0..10000; null unless calc = pct_of_ctc */
  pctOfCtcBps: number | null;
  /** paise; null unless calc = fixed */
  fixedMinor: bigint | null;
  employerCostClass: EmployerCostClass | null;
  costPlacement: CostPlacement;
  countsForPfWage: boolean;
  countsForEsiWage: boolean;
  countsForGratuity: boolean;
  lopApplicable: boolean;
  payslipOrder: number | null;
}

/**
 * Owner decision (10 Nov 2026, second set): loss of pay applies to every component by default, EXCEPT fixed
 * reimbursements (phone, conveyance, ...) which default to not reduced. A reimbursement here is a fixed, non-taxable
 * earning. Employer costs are not paid to the employee, so loss of pay does not apply to them (the engine prorates them
 * by days out of service only). A run structure never honours the flag, so its default stays false.
 * Only the DEFAULT: an explicit value from the author always wins.
 */
export function defaultLopApplicable(kind: StructureKind, c: Pick<ComponentSpec, "componentType" | "calc" | "isTaxable">): boolean {
  if (kind !== "ctc_template") return false;
  if (c.componentType !== "earning") return false;
  const fixedReimbursement = c.calc === "fixed" && !c.isTaxable;
  return !fixedReimbursement;
}

export type SpecIssue = { code: string; field: string; message: string };

/** Validate one component against the structure kind it is being written to. Empty array = valid. isNew=false (an edit) skips the code rules. */
export function validateComponentSpec(kind: StructureKind, c: ComponentSpec, opts: { isNew?: boolean } = {}): SpecIssue[] {
  const isNew = opts.isNew ?? true;
  const issues: SpecIssue[] = [];
  const bad = (code: string, field: string, message: string) => issues.push({ code, field, message });

  // Legacy rows predate the code charset and the reserved list; the code is immutable, so judge it on create only.
  if (isNew && !COMPONENT_CODE_RE.test(c.code)) bad("CODE_INVALID", "code", "code must be 2-32 characters: capital letters, digits and underscore, starting with a letter");
  if (c.name.trim().length < 1 || c.name.length > 128) bad("NAME_INVALID", "name", "name must be 1-128 characters");
  if (c.payslipOrder != null && (!Number.isInteger(c.payslipOrder) || c.payslipOrder < 0 || c.payslipOrder > 32000)) {
    bad("ORDER_INVALID", "payslipOrder", "payslip order must be a whole number from 0 to 32000");
  }

  if (kind === "run") {
    // A run structure is read by the live engine: allow only what it honours, so nothing is silently ignored.
    if (isNew && (RESERVED_RUN_CODES as readonly string[]).includes(c.code)) {
      bad("CODE_RESERVED", "code", `${c.code} is computed by the payroll engine and cannot be added to a run structure`);
    }
    if (c.componentType !== "earning" && c.componentType !== "deduction") bad("TYPE_NOT_ALLOWED", "componentType", "a run structure component is an earning or a deduction");
    if (c.calc == null || !RUN_CALC_TYPES.includes(c.calc)) bad("CALC_NOT_ALLOWED", "calc", "a run structure component is a fixed amount or a percentage of basic");
    if (c.employerCostClass != null) bad("EMPLOYER_CLASS_NOT_ALLOWED", "employerCostClass", "employer costs belong to a CTC template");
    if (c.countsForPfWage || c.countsForEsiWage || c.countsForGratuity) bad("WAGE_FLAGS_NOT_ALLOWED", "countsForPfWage", "wage-base flags apply to CTC templates only; a run structure does not use them yet");
    if (c.lopApplicable) bad("LOP_NOT_ALLOWED", "lopApplicable", "loss-of-pay on structure components is not honoured by the run engine yet");
  } else {
    if (c.componentType !== "earning" && c.componentType !== "employer_cost") bad("TYPE_NOT_ALLOWED", "componentType", "a CTC template line is an earning or an employer cost");
    if ((c.componentType === "employer_cost") !== (c.employerCostClass != null)) {
      bad("EMPLOYER_CLASS_MISMATCH", "employerCostClass", "an employer cost needs a cost class, and only an employer cost may have one");
    }
    if (c.employerCostClass != null && STATUTORY_DERIVED_CLASSES.includes(c.employerCostClass)) {
      if (c.calc != null || c.pctOfBasic != null || c.pctOfCtcBps != null || c.fixedMinor != null) {
        bad("STATUTORY_CLASS_NO_AMOUNT", "calc", "employer PF and ESI are derived from the statutory configuration and take no calculation or amount");
      }
    } else if (c.calc == null) {
      bad("CALC_REQUIRED", "calc", "choose how the amount is calculated");
    }
    if (c.calc === "balancing" && (c.componentType !== "earning" || c.employerCostClass != null)) {
      bad("BALANCING_MUST_BE_EARNING", "calc", "only an earning can be the balancing component");
    }
    if (c.employerCostClass == null && c.costPlacement !== "inside_ctc") bad("PLACEMENT_NEEDS_CLASS", "costPlacement", "placement applies to employer costs only");
  }

  // Amount shape follows calc exactly: the matching field present, the others absent.
  const present = {
    pct_of_basic: c.pctOfBasic != null, pct_of_ctc: c.pctOfCtcBps != null, fixed: c.fixedMinor != null,
  };
  if (c.calc === "pct_of_basic") {
    if (!present.pct_of_basic || present.pct_of_ctc || present.fixed) bad("AMOUNT_MISMATCH", "pctOfBasic", "percent of basic needs pctOfBasic and no other amount");
    else if (c.pctOfBasic! < 0 || c.pctOfBasic! > 100 || Math.round(c.pctOfBasic! * 100) / 100 !== c.pctOfBasic) bad("PCT_RANGE", "pctOfBasic", "percent of basic must be 0 to 100 with at most 2 decimals");
  } else if (c.calc === "pct_of_ctc") {
    if (!present.pct_of_ctc || present.pct_of_basic || present.fixed) bad("AMOUNT_MISMATCH", "pctOfCtcBps", "percent of CTC needs pctOfCtcBps and no other amount");
    else if (!Number.isInteger(c.pctOfCtcBps) || c.pctOfCtcBps! < 0 || c.pctOfCtcBps! > 10000) bad("PCT_RANGE", "pctOfCtcBps", "percent of CTC must be 0 to 10000 basis points");
  } else if (c.calc === "fixed") {
    if (!present.fixed || present.pct_of_basic || present.pct_of_ctc) bad("AMOUNT_MISMATCH", "fixedMinor", "a fixed component needs fixedMinor and no other amount");
    else if (c.fixedMinor! < 0n || c.fixedMinor! > MAX_FIXED_MINOR) bad("FIXED_RANGE", "fixedMinor", "fixed amount must be zero or more and below the sanity limit");
  } else if (c.calc === "balancing") {
    if (present.pct_of_basic || present.pct_of_ctc || present.fixed) bad("AMOUNT_MISMATCH", "calc", "the balancing component takes the remainder and has no amount of its own");
  }
  return issues;
}

export interface TemplateLine { code: string; calc: ComponentCalcType | null; pctOfCtcBps: number | null; isActive: boolean; employerCostClass: EmployerCostClass | null; costPlacement?: CostPlacement }
export interface TemplateCheck { errors: SpecIssue[]; warnings: SpecIssue[] }

/**
 * Template-level checks over the ACTIVE lines (owner decision 1): block more than one balancing line and
 * more than 100% of CTC; warn when basic is under 50% of CTC (labour-code wage definition, VERIFY with
 * counsel) and when the parts cannot be shown to sum to CTC. A run structure has no template checks.
 */
export function checkTemplate(lines: TemplateLine[]): TemplateCheck {
  const errors: SpecIssue[] = [];
  const warnings: SpecIssue[] = [];
  const active = lines.filter((l) => l.isActive);
  const balancing = active.filter((l) => l.calc === "balancing");
  if (balancing.length > 1) errors.push({ code: "MULTIPLE_BALANCING", field: "calc", message: "a template can have only one balancing component" });
  // CTC is what the employer commits INCLUDING inside_ctc employer costs; an on_top employer cost is paid in addition
  // to CTC, so it neither uses up the 100% nor is carved out of the balancing remainder.
  const ctcBps = active.reduce((s, l) => s + (l.calc === "pct_of_ctc" && !(l.employerCostClass && l.costPlacement === "on_top") ? l.pctOfCtcBps ?? 0 : 0), 0);
  if (ctcBps > 10000) errors.push({ code: "PCT_OF_CTC_OVER_100", field: "pctOfCtcBps", message: `percent-of-CTC components add up to ${(ctcBps / 100).toFixed(2)}%, which is more than 100%` });
  const basic = active.find((l) => l.code === "BASIC");
  if (!basic) warnings.push({ code: "NO_BASIC", field: "code", message: "the template has no BASIC component" });
  else if (basic.calc === "pct_of_ctc" && (basic.pctOfCtcBps ?? 0) < 5000) {
    warnings.push({ code: "BASIC_BELOW_50_PCT", field: "pctOfCtcBps", message: "basic is under 50% of CTC; the labour-code wage definition may require at least 50% (VERIFY with counsel)" });
  }
  if (!basic && active.some((l) => l.calc === "pct_of_basic")) warnings.push({ code: "PCT_OF_BASIC_WITHOUT_BASIC", field: "calc", message: "a component is a percentage of basic but the template has no BASIC component" });
  if (balancing.length === 0 && active.length > 0) {
    warnings.push({ code: "NO_BALANCING", field: "calc", message: "no balancing component: the parts will not necessarily add up to CTC" });
  }
  return { errors, warnings };
}

export interface TemplateVersionInfo { id: string; templateVersion: number; effectiveFrom: string | null; isLocked: boolean; kind: StructureKind }

/**
 * The version of a template lineage a CTC engine must use for a payroll month (YYYY-MM): only LOCKED
 * ctc_template versions qualify; of those, the latest whose effective_from falls on or before the end of the
 * month (ties broken by the higher template_version). A version without an effective_from never resolves.
 * Mid-month effective dates are the engine's proration concern (G1).
 */
export function pickTemplateVersion(versions: TemplateVersionInfo[], month: string): TemplateVersionInfo | null {
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const endOfMonth = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const ok = versions.filter((v) => v.kind === "ctc_template" && v.isLocked && v.effectiveFrom != null && v.effectiveFrom <= endOfMonth);
  ok.sort((a, b) => (a.effectiveFrom! === b.effectiveFrom! ? b.templateVersion - a.templateVersion : a.effectiveFrom! < b.effectiveFrom! ? 1 : -1));
  return ok[0] ?? null;
}
