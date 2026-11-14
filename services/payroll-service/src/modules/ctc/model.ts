/**
 * Section 8 gap G1: the CTC expansion and solver. PURE: no I/O, no clock, no flag read.
 *
 * Turns an annual fixed CTC and the LOCKED template version for the month (resolved by the caller through
 * pay-components `resolveTemplateForMonth` / `pickTemplateVersion`, never read directly here) into the
 * monthly components of one employee:
 *
 *   % of CTC, % of basic, fixed, and the balancing line (owner decision 1, 10 Nov 2026);
 *   employer costs INSIDE CTC (carved out of the balancing remainder) versus ON TOP (paid in addition);
 *   employer PF and employer ESI derived from the effective-dated statutory config, so a ceiling-capped PF
 *   (or the "actual basic" wage basis, owner decision 2) changes the balancing figure correctly;
 *   gratuity provision as a % of basic (a template parameter, never a constant here);
 *   a per-employee override of single components (negotiated HRA) without a new template.
 *
 * Every statutory figure arrives in `cfg` (StatutoryConfig, effective-dated, resolved by the run). The PF and
 * ESI formulas below mirror computeSlip (payroll/domain.ts) line for line, so the employer cost the solver
 * carves out of CTC is the employer cost the slip will actually book (asserted by the real-DB test).
 *
 * Rounding: whole rupees per line (roundRupee, as the engine). The monthly CTC M is annual/12 rounded to the
 * rupee. The balancing line takes the largest whole-rupee value that fits; because PF/ESI are themselves
 * rounded to the rupee, up to Rs 1-2 can stay unallocated (reported as `unallocatedMinor`, never hidden).
 */
import { roundRupee, type StatutoryConfig } from "../payroll/domain.js";
import { proratedPayMinor } from "../integration/lop-math.js";
import type { ComponentCalcType, CostPlacement, EmployerCostClass } from "../pay-components/model.js";

/** Feature flag. Default OFF: only the exact string "true" lets a ctc_contract profile be planned. */
export const CTC_PROFILE_FLAG = "S8_CTC_PROFILE_ENABLED";
export function ctcProfileEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CTC_PROFILE_FLAG] === "true";
}

export class CtcError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "CtcError";
  }
}

/** One line of a LOCKED ctc_template version (the G2 component row, money as bigint). */
export interface CtcTemplateLine {
  code: string;
  name: string;
  componentType: "earning" | "employer_cost";
  calc: ComponentCalcType | null;
  /** percent of basic, 0..100, 2 decimals; calc = pct_of_basic */
  pctOfBasic: number | null;
  /** basis points of monthly fixed CTC; calc = pct_of_ctc */
  pctOfCtcBps: number | null;
  /** paise; calc = fixed */
  fixedMinor: bigint | null;
  employerCostClass: EmployerCostClass | null;
  costPlacement: CostPlacement;
  countsForPfWage: boolean;
  countsForEsiWage: boolean;
  countsForGratuity: boolean;
  lopApplicable: boolean;
  payslipOrder: number | null;
}

/** The approved per-employee CTC terms (hrms_pay_profiles.ctc_terms), money as bigint. */
export interface CtcTerms {
  annualFixedMinor: bigint;
  /** Informational only (design 2.2 "Variable pay"): never in the monthly fixed amount. */
  annualVariableTargetMinor: bigint | null;
  /** "ceiling" = EPF on min(PF wage, ceiling); "actual" = EPF on the actual PF wage (owner decision 2). */
  epfWagePolicy: "ceiling" | "actual";
  /** false drops the gratuity_provision lines of the template for this employee. */
  gratuityProvisionOn: boolean;
  /** Per-employee override of single template lines: the monthly amount replaces the template rule. */
  overrides: Array<{ code: string; monthlyMinor: bigint }>;
}

export interface CtcExpandInput {
  lines: CtcTemplateLine[];
  terms: CtcTerms;
  /** Effective-dated PF / ESI config for the month (resolveStatutoryConfig). */
  cfg: StatutoryConfig;
  /** false = the engagement carries no provident fund (statutoryPf). Default true. */
  pfApplicable?: boolean;
  /** false = the engagement carries no ESI (statutoryEsi). Default true. */
  statutoryEsi?: boolean;
}

export type CtcLineSource = "template" | "override" | "balancing" | "derived";

export interface CtcLineOut {
  code: string;
  name: string;
  type: "earning" | "employer_cost";
  /** Full-month amount, whole rupees (paise). */
  amountMinor: bigint;
  employerCostClass: EmployerCostClass | null;
  costPlacement: CostPlacement;
  calc: ComponentCalcType | null;
  /** kept so gratuity (pct_of_basic) can be re-priced on a prorated basic */
  pctOfBasic: number | null;
  lopApplicable: boolean;
  countsForPfWage: boolean;
  countsForEsiWage: boolean;
  countsForGratuity: boolean;
  payslipOrder: number | null;
  source: CtcLineSource;
}

export interface CtcWarning { code: string; message: string }

export interface CtcExpansion {
  /** annual fixed CTC / 12, whole rupees. */
  monthlyCtcMinor: bigint;
  earnings: CtcLineOut[];
  employerCosts: CtcLineOut[];
  basicMinor: bigint;
  /** Sum of the monthly earnings (what the slip books as gross before one-offs). */
  grossMinor: bigint;
  /** Earnings flagged counts_for_pf_wage. */
  pfWageMinor: bigint;
  employerPfMinor: bigint;
  employerEsiMinor: bigint;
  /** true when the employee is under the ESI ceiling and ESI applies at the full-month gross. */
  esiApplies: boolean;
  gratuityMinor: bigint;
  /** Employer costs that are part of CTC. */
  insideCtcCostsMinor: bigint;
  /** Employer costs paid in addition to CTC. */
  onTopCostsMinor: bigint;
  /** monthlyCtc - gross - insideCtcCosts. Zero when exact; at most Rs 1-2 from rounding; non-zero without a balancing line. */
  unallocatedMinor: bigint;
  annualVariableTargetMinor: bigint | null;
  epfWagePolicy: "ceiling" | "actual";
  warnings: CtcWarning[];
}

const pctRupee = (base: bigint, percent: bigint): bigint => roundRupee((base * percent) / 100n);
const bpsRupee = (base: bigint, bps: bigint): bigint => roundRupee((base * bps) / 10000n);
const pctOfBasicMinor = (basic: bigint, pct: number): bigint => roundRupee((basic * BigInt(Math.round(pct * 100))) / 10_000n);

/** PF the engine books for an employer: pct(min(pfWage, ceiling) or pfWage when "actual", rate). Mirrors computeSlip. */
export function employerPfFor(pfWageMinor: bigint, cfg: StatutoryConfig, policy: "ceiling" | "actual"): bigint {
  const base = pfWageMinor > 0n ? pfWageMinor : 0n;
  const wage = policy !== "actual" && base > cfg.pfWageCapMinor ? cfg.pfWageCapMinor : base;
  return pctRupee(wage, cfg.pfRatePct);
}

/** Employer ESI the engine books: the whole gross, when ESI applies. Mirrors computeSlip. */
export function employerEsiFor(grossMinor: bigint, cfg: StatutoryConfig, applies: boolean): bigint {
  return applies ? bpsRupee(grossMinor, cfg.esiEmployerRateBps) : 0n;
}

export function esiApplicableAt(grossMinor: bigint, cfg: StatutoryConfig, eligible: boolean): boolean {
  return eligible && grossMinor <= cfg.esiWageCapMinor;
}

const out = (l: CtcTemplateLine, amountMinor: bigint, source: CtcLineSource): CtcLineOut => ({
  code: l.code, name: l.name, type: l.componentType, amountMinor, employerCostClass: l.employerCostClass,
  costPlacement: l.costPlacement, calc: l.calc, pctOfBasic: l.pctOfBasic, lopApplicable: l.lopApplicable,
  countsForPfWage: l.countsForPfWage, countsForEsiWage: l.countsForEsiWage, countsForGratuity: l.countsForGratuity,
  payslipOrder: l.payslipOrder, source,
});

export function expandCtc(input: CtcExpandInput): CtcExpansion {
  const { terms, cfg } = input;
  const pfApplicable = input.pfApplicable !== false;
  const esiEligible = input.statutoryEsi !== false; // engagement gate only: ESI has no employee opt-out
  if (terms.annualFixedMinor <= 0n) throw new CtcError("CTC_AMOUNT_INVALID", "annual fixed CTC must be positive");
  const M = roundRupee(terms.annualFixedMinor / 12n);
  const warnings: CtcWarning[] = [];

  const seen = new Set<string>();
  for (const l of input.lines) {
    if (seen.has(l.code)) throw new CtcError("CTC_TEMPLATE_DUPLICATE_CODE", `template has two lines coded ${l.code}`);
    seen.add(l.code);
  }
  const lines = input.lines.filter((l) => terms.gratuityProvisionOn || l.employerCostClass !== "gratuity_provision");

  // Overrides: single named lines, never the balancing line nor a statutory-derived employer cost.
  const overrides = new Map<string, bigint>();
  for (const o of terms.overrides) {
    const l = lines.find((x) => x.code === o.code);
    if (!l) throw new CtcError("CTC_OVERRIDE_UNKNOWN_COMPONENT", `override names ${o.code}, which is not a line of the template`);
    if (l.calc === "balancing") throw new CtcError("CTC_OVERRIDE_BALANCING", `${o.code} is the balancing line and cannot be overridden`);
    if (l.employerCostClass === "employer_pf" || l.employerCostClass === "employer_esi") throw new CtcError("CTC_OVERRIDE_STATUTORY", `${o.code} is derived from the statutory configuration and cannot be overridden`);
    if (o.monthlyMinor < 0n) throw new CtcError("CTC_OVERRIDE_NEGATIVE", `override of ${o.code} is negative`);
    if (overrides.has(o.code)) throw new CtcError("CTC_OVERRIDE_DUPLICATE", `${o.code} is overridden twice`);
    overrides.set(o.code, roundRupee(o.monthlyMinor));
  }

  const earningLines = lines.filter((l) => l.componentType === "earning");
  const balancingLines = earningLines.filter((l) => l.calc === "balancing");
  if (balancingLines.length > 1) throw new CtcError("CTC_TEMPLATE_MULTIPLE_BALANCING", "a template can have only one balancing component");
  const balancing = balancingLines[0] ?? null;

  // BASIC must be a direct amount: the % of basic lines and the gratuity base hang off it.
  const basicLine = earningLines.find((l) => l.code === "BASIC");
  if (!basicLine) throw new CtcError("CTC_TEMPLATE_NO_BASIC", "the template has no BASIC component");
  if (!overrides.has("BASIC") && basicLine.calc !== "fixed" && basicLine.calc !== "pct_of_ctc") {
    throw new CtcError("CTC_BASIC_NOT_DIRECT", "BASIC must be a fixed amount or a percent of CTC");
  }
  const direct = (l: CtcTemplateLine): bigint => {
    if (l.calc === "fixed") return roundRupee(l.fixedMinor ?? 0n);
    if (l.calc === "pct_of_ctc") return bpsRupee(M, BigInt(l.pctOfCtcBps ?? 0));
    throw new CtcError("CTC_LINE_NOT_DIRECT", `${l.code} is not a direct amount`);
  };
  const basic = overrides.get("BASIC") ?? direct(basicLine);

  const amountOf = (l: CtcTemplateLine): { amount: bigint; source: CtcLineSource } => {
    const ov = overrides.get(l.code);
    if (ov != null) return { amount: ov, source: "override" };
    if (l.calc === "pct_of_basic") return { amount: pctOfBasicMinor(basic, l.pctOfBasic ?? 0), source: "template" };
    return { amount: direct(l), source: "template" };
  };

  // Earnings other than the balancing line.
  const earningsOut: CtcLineOut[] = [];
  for (const l of earningLines) {
    if (l.calc === "balancing") continue;
    const { amount, source } = amountOf(l);
    earningsOut.push(out(l, l.code === "BASIC" ? basic : amount, l.code === "BASIC" && overrides.has("BASIC") ? "override" : source));
  }
  const E0 = earningsOut.reduce((s, e) => s + e.amountMinor, 0n);
  const pfFixed = earningsOut.filter((e) => e.countsForPfWage).reduce((s, e) => s + e.amountMinor, 0n);

  // Gratuity base: the earnings flagged counts_for_gratuity when any is, else BASIC.
  const flagged = earningsOut.filter((e) => e.countsForGratuity);
  const gratuityBase = flagged.length > 0 ? flagged.reduce((s, e) => s + e.amountMinor, 0n) : basic;

  // Employer costs the template carries (non-statutory), then the statutory-derived ones.
  const employerOut: CtcLineOut[] = [];
  for (const l of lines.filter((x) => x.componentType === "employer_cost")) {
    if (l.employerCostClass === "employer_pf" || l.employerCostClass === "employer_esi") continue;
    const ov = overrides.get(l.code);
    let amount: bigint;
    if (ov != null) amount = ov;
    else if (l.calc === "pct_of_basic") amount = pctOfBasicMinor(l.employerCostClass === "gratuity_provision" ? gratuityBase : basic, l.pctOfBasic ?? 0);
    else amount = direct(l);
    employerOut.push(out(l, amount, ov != null ? "override" : "template"));
  }
  const insideFixed = employerOut.filter((e) => e.costPlacement === "inside_ctc").reduce((s, e) => s + e.amountMinor, 0n);
  const pfLine = lines.find((l) => l.employerCostClass === "employer_pf") ?? null;
  const esiLine = lines.find((l) => l.employerCostClass === "employer_esi") ?? null;
  const pfInside = pfApplicable && !!pfLine && pfLine.costPlacement === "inside_ctc";
  const esiInside = !!esiLine && esiLine.costPlacement === "inside_ctc";

  // Total CTC-side cost for a balancing amount S and an ESI state.
  const evalAt = (S: bigint, esiOn: boolean) => {
    const gross = E0 + S;
    const pfWage = pfFixed + (balancing?.countsForPfWage ? S : 0n);
    const erPf = pfApplicable ? employerPfFor(pfWage, cfg, terms.epfWagePolicy) : 0n;
    const erEsi = employerEsiFor(gross, cfg, esiOn);
    const inside = insideFixed + (pfInside ? erPf : 0n) + (esiInside ? erEsi : 0n);
    return { gross, pfWage, erPf, erEsi, inside, total: gross + inside };
  };

  let S = 0n;
  let esiOn: boolean;
  if (!balancing) {
    esiOn = esiApplicableAt(E0, cfg, esiEligible);
  } else {
    // Largest whole-rupee S with total <= M, for a fixed ESI state (total is non-decreasing in S).
    const solve = (on: boolean): bigint => {
      if (evalAt(0n, on).total > M) throw new CtcError("CTC_NEGATIVE_BALANCING", `the fixed parts and employer costs exceed the monthly CTC; the balancing component ${balancing.code} would be negative`);
      let lo = 0n, hi = M / 100n;
      while (lo < hi) {
        const mid = (lo + hi + 1n) / 2n;
        if (evalAt(mid * 100n, on).total <= M) lo = mid; else hi = mid - 1n;
      }
      return lo * 100n;
    };
    const sOff = solve(false);
    if (esiApplicableAt(E0 + sOff, cfg, esiEligible)) {
      // Under the ceiling with ESI off => ESI applies; with employer ESI inside CTC the gross must shrink to pay for it.
      S = esiInside ? solve(true) : sOff;
      esiOn = true;
    } else {
      S = sOff;
      esiOn = false;
    }
  }
  const fin = evalAt(S, esiOn);
  if (balancing) earningsOut.push(out(balancing, S, "balancing"));

  // Statutory-derived employer lines. Without a template line they are real costs on top of CTC.
  const derived = (cls: EmployerCostClass, tpl: CtcTemplateLine | null, code: string, name: string, amount: bigint): void => {
    employerOut.push(tpl ? out(tpl, amount, "derived") : {
      code, name, type: "employer_cost", amountMinor: amount, employerCostClass: cls, costPlacement: "on_top", calc: null, pctOfBasic: null,
      lopApplicable: false, countsForPfWage: false, countsForEsiWage: false, countsForGratuity: false, payslipOrder: null, source: "derived",
    });
  };
  if (pfApplicable) derived("employer_pf", pfLine, "EMPLOYER_PF", "Employer PF (EPF + EPS)", fin.erPf);
  if (esiOn && fin.erEsi > 0n) derived("employer_esi", esiLine, "EMPLOYER_ESI", "Employer ESI", fin.erEsi);

  earningsOut.sort((a, b) => (a.payslipOrder ?? 32001) - (b.payslipOrder ?? 32001));
  const inside = employerOut.filter((e) => e.costPlacement === "inside_ctc").reduce((s, e) => s + e.amountMinor, 0n);
  const onTop = employerOut.filter((e) => e.costPlacement === "on_top").reduce((s, e) => s + e.amountMinor, 0n);
  const gross = earningsOut.reduce((s, e) => s + e.amountMinor, 0n);
  const unallocated = M - gross - inside;

  if (!pfLine && pfApplicable) warnings.push({ code: "PF_NOT_IN_TEMPLATE", message: "the template has no employer PF line, so employer PF is paid on top of CTC" });
  if (esiOn && !esiLine) warnings.push({ code: "ESI_NOT_IN_TEMPLATE", message: "the template has no employer ESI line, so employer ESI is paid on top of CTC" });
  if (!balancing && unallocated !== 0n) warnings.push({ code: "PARTS_DO_NOT_SUM_TO_CTC", message: `the components and inside-CTC employer costs differ from the monthly CTC by ${unallocated} paise` });
  if (basic * 2n < M) warnings.push({ code: "BASIC_BELOW_50_PCT", message: "basic is under 50% of CTC; the labour-code wage definition may require at least 50% (VERIFY with counsel)" });
  // The ESI ceiling is a cliff: a Rs 1 change in CTC can switch ESI on or off.
  if (esiEligible && (esiInside || !!esiLine)) {
    const near = cfg.esiWageCapMinor / 10n; // within 10% of the ceiling
    const diff = fin.gross > cfg.esiWageCapMinor ? fin.gross - cfg.esiWageCapMinor : cfg.esiWageCapMinor - fin.gross;
    if (diff <= near) warnings.push({ code: "ESI_CEILING_CLIFF", message: "gross is within 10% of the ESI wage ceiling; a small CTC change can switch ESI on or off and move take-home" });
  }

  const gratuity = employerOut.filter((e) => e.employerCostClass === "gratuity_provision").reduce((s, e) => s + e.amountMinor, 0n);
  return {
    monthlyCtcMinor: M, earnings: earningsOut, employerCosts: employerOut, basicMinor: basic, grossMinor: gross,
    pfWageMinor: fin.pfWage, employerPfMinor: pfApplicable ? fin.erPf : 0n, employerEsiMinor: esiOn ? fin.erEsi : 0n, esiApplies: esiOn,
    gratuityMinor: gratuity, insideCtcCostsMinor: inside, onTopCostsMinor: onTop, unallocatedMinor: unallocated,
    annualVariableTargetMinor: terms.annualVariableTargetMinor, epfWagePolicy: terms.epfWagePolicy, warnings,
  };
}

/** What one month of pay looks like once the calendar days actually paid are known. */
export interface CtcPaidMonth {
  earnings: Array<{ code: string; name: string; type: "earning"; amountMinor: bigint }>;
  basicMinor: bigint;
  hraMinor: bigint;
  grossMinor: bigint;
  /** Prorated earnings flagged counts_for_pf_wage: the PF wage the slip books PF on. */
  pfWageMinor: bigint;
  employerPfMinor: bigint;
  employerEsiMinor: bigint;
  gratuityMinor: bigint;
  /** Employer costs after proration, for the slip's employer section and the snapshot. */
  employerCosts: Array<{ code: string; name: string; amountMinor: bigint; employerCostClass: EmployerCostClass | null; costPlacement: CostPlacement }>;
}

/**
 * Prorate by calendar days (owner decision 3). `lopDays` = every unpaid day (leave / attendance LOP and the
 * days before joining / after leaving), applied to lines flagged lop_applicable; `notInServiceDays` = only the
 * days outside service, which reach every line (a joiner is not paid a day before joining whatever the flag).
 * Reuses lop-math `proratedPayMinor`. PF, ESI and gratuity are then priced on the prorated figures with the
 * same formulas as the full month (the ceiling applies to wages actually earned, VERIFY).
 */
export function prorateExpansion(
  exp: CtcExpansion,
  p: { lopDays: number; notInServiceDays: number; daysInMonth: bigint },
  cfg: StatutoryConfig,
  o: { pfApplicable?: boolean; esiEligible?: boolean } = {},
): CtcPaidMonth {
  const prorate = (amount: bigint, days: number): bigint => (days > 0 ? roundRupee(proratedPayMinor(amount, days, p.daysInMonth)) : amount);
  const earnings = exp.earnings.map((e) => ({
    code: e.code, name: e.name, type: "earning" as const, countsForPfWage: e.countsForPfWage,
    amountMinor: prorate(e.amountMinor, e.lopApplicable ? p.lopDays : p.notInServiceDays),
  }));
  const gross = earnings.reduce((s, e) => s + e.amountMinor, 0n);
  const basic = earnings.find((e) => e.code === "BASIC")?.amountMinor ?? 0n;
  const hra = earnings.find((e) => e.code === "HRA")?.amountMinor ?? 0n;
  const pfWage = earnings.filter((e) => e.countsForPfWage).reduce((s, e) => s + e.amountMinor, 0n);
  const erPf = o.pfApplicable === false ? 0n : employerPfFor(pfWage, cfg, exp.epfWagePolicy);
  const esiOn = esiApplicableAt(gross, cfg, o.esiEligible !== false);
  const erEsi = employerEsiFor(gross, cfg, esiOn);
  // Gratuity and other template employer costs; the base of a % of basic line is the prorated basic.
  const employerCosts: CtcPaidMonth["employerCosts"] = [];
  for (const c of exp.employerCosts) {
    if (c.employerCostClass === "employer_pf") { if (o.pfApplicable !== false) employerCosts.push({ code: c.code, name: c.name, amountMinor: erPf, employerCostClass: c.employerCostClass, costPlacement: c.costPlacement }); continue; }
    if (c.employerCostClass === "employer_esi") { if (erEsi > 0n) employerCosts.push({ code: c.code, name: c.name, amountMinor: erEsi, employerCostClass: c.employerCostClass, costPlacement: c.costPlacement }); continue; }
    const amount = c.source === "template" && c.calc === "pct_of_basic" && c.employerCostClass === "gratuity_provision" && exp.earnings.every((e) => !e.countsForGratuity)
      ? pctOfBasicMinor(basic, c.pctOfBasic ?? 0)
      : prorate(c.amountMinor, p.notInServiceDays);
    employerCosts.push({ code: c.code, name: c.name, amountMinor: amount, employerCostClass: c.employerCostClass, costPlacement: c.costPlacement });
  }
  // An ESI cost that only became due on the prorated gross (a part-month joiner under the ceiling) is on top.
  if (erEsi > 0n && !employerCosts.some((c) => c.employerCostClass === "employer_esi")) {
    employerCosts.push({ code: "EMPLOYER_ESI", name: "Employer ESI", amountMinor: erEsi, employerCostClass: "employer_esi", costPlacement: "on_top" });
  }
  const gratuity = employerCosts.filter((c) => c.employerCostClass === "gratuity_provision").reduce((s, c) => s + c.amountMinor, 0n);
  return {
    earnings: earnings.map(({ code, name, type, amountMinor }) => ({ code, name, type, amountMinor })),
    basicMinor: basic, hraMinor: hra, grossMinor: gross, pfWageMinor: pfWage,
    employerPfMinor: erPf, employerEsiMinor: erEsi, gratuityMinor: gratuity, employerCosts,
  };
}

/**
 * What planEmployeePay needs to plan a ctc_contract employee: the LOCKED template version resolved for the
 * month, per template lineage (null = no approved template covers the month), and the month's statutory config.
 * Absent (flag off) the profile fails exactly as before this module existed.
 */
export interface CtcResolvedTemplate { structureId: string; templateVersion: number; effectiveFrom: string; lines: CtcTemplateLine[] }
export interface CtcPlanContext {
  templates: ReadonlyMap<string, CtcResolvedTemplate | null>;
  cfg: StatutoryConfig;
}

/** The plan-time CTC result carried on EmployeePayPlan. */
export interface CtcPlan {
  expansion: CtcExpansion;
  template: { lineageId: string; structureId: string; templateVersion: number; effectiveFrom: string };
  pfApplicable: boolean;
  esiEligible: boolean;
}
