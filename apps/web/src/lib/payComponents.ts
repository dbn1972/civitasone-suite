/**
 * Section 8 G2: client mirror of the pay-component contract in
 * services/payroll-service/src/modules/pay-components/model.ts (docs/design/S8-G2-COMPONENTS.md).
 * The server stays the authority and re-validates; /v1/payroll/pay-components/meta returns the same sets
 * so a drift shows up as a refused save, not as a wrong payslip. Messages are `payComponents` keys.
 */
import { nonNegativeRupeesToMinorString, percentToBps } from "@/lib/money";

export const STRUCTURE_KINDS = ["run", "ctc_template"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];
export const COMPONENT_CALC_TYPES = ["pct_of_ctc", "pct_of_basic", "fixed", "balancing"] as const;
export type CalcType = (typeof COMPONENT_CALC_TYPES)[number];
export const EMPLOYER_COST_CLASSES = ["employer_pf", "employer_esi", "gratuity_provision", "group_insurance", "other_employer"] as const;
export type EmployerCostClass = (typeof EMPLOYER_COST_CLASSES)[number];
export const STATUTORY_DERIVED_CLASSES: readonly EmployerCostClass[] = ["employer_pf", "employer_esi"];
export const COST_PLACEMENTS = ["inside_ctc", "on_top"] as const;
export type CostPlacement = (typeof COST_PLACEMENTS)[number];
export const RUN_CALC_TYPES: readonly CalcType[] = ["fixed", "pct_of_basic"];
export const RESERVED_RUN_CODES = ["BASIC", "DA", "HRA"] as const;
export const COMPONENT_CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

export interface ComponentForm {
  code: string; name: string;
  componentType: "earning" | "deduction" | "employer_cost";
  calc: CalcType | "";
  pctOfBasic: string; pctOfCtc: string; fixedRupees: string;
  employerCostClass: EmployerCostClass | "";
  costPlacement: CostPlacement;
  isTaxable: boolean; countsForPfWage: boolean; countsForEsiWage: boolean; countsForGratuity: boolean; lopApplicable: boolean;
}

export const emptyForm = (kind: StructureKind): ComponentForm => ({
  code: "", name: "", componentType: "earning", calc: kind === "run" ? "fixed" : "pct_of_ctc",
  pctOfBasic: "", pctOfCtc: "", fixedRupees: "", employerCostClass: "", costPlacement: "inside_ctc",
  isTaxable: false, countsForPfWage: false, countsForEsiWage: false, countsForGratuity: false, lopApplicable: false,
});

export type FormErrors = Partial<Record<"code" | "name" | "calc" | "amount" | "employerCostClass", string>>;

export interface ComponentPayload {
  code?: string; name: string; componentType: string; isTaxable: boolean; calc: CalcType | null;
  pctOfBasic: number | null; pctOfCtcBps: number | null; fixedMinor: string | null;
  employerCostClass: EmployerCostClass | null; costPlacement: CostPlacement;
  countsForPfWage: boolean; countsForEsiWage: boolean; countsForGratuity: boolean; lopApplicable: boolean;
}

/** Validate the form for a structure kind and build the request body. Errors are message keys. */
export function parseComponentForm(kind: StructureKind, f: ComponentForm, isNew: boolean):
  { ok: true; payload: ComponentPayload } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const code = f.code.trim();
  if (isNew) {
    if (!COMPONENT_CODE_RE.test(code)) errors.code = "errCode";
    else if (kind === "run" && (RESERVED_RUN_CODES as readonly string[]).includes(code)) errors.code = "errCodeReserved";
  }
  if (f.name.trim().length < 1 || f.name.length > 128) errors.name = "errName";

  const statutory = f.employerCostClass !== "" && STATUTORY_DERIVED_CLASSES.includes(f.employerCostClass);
  const calc: CalcType | null = statutory ? null : f.calc === "" ? null : f.calc;
  if (!statutory && calc == null) errors.calc = "errCalc";
  if (kind === "run" && calc != null && !RUN_CALC_TYPES.includes(calc)) errors.calc = "errCalcRun";
  if (f.componentType === "employer_cost" && f.employerCostClass === "") errors.employerCostClass = "errEmployerClass";

  let pctOfBasic: number | null = null;
  let pctOfCtcBps: number | null = null;
  let fixedMinor: string | null = null;
  if (calc === "pct_of_basic") {
    const bps = percentToBps(f.pctOfBasic);
    if (bps === null || bps > 10000) errors.amount = "errPctBasic"; else pctOfBasic = bps / 100;
  } else if (calc === "pct_of_ctc") {
    const bps = percentToBps(f.pctOfCtc);
    if (bps === null || bps > 10000) errors.amount = "errPctCtc"; else pctOfCtcBps = bps;
  } else if (calc === "fixed") {
    const m = nonNegativeRupeesToMinorString(f.fixedRupees);
    if (m === null) errors.amount = "errFixed"; else fixedMinor = m;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const template = kind === "ctc_template";
  const payload: ComponentPayload = {
    name: f.name.trim(), componentType: f.componentType, isTaxable: f.isTaxable, calc, pctOfBasic, pctOfCtcBps, fixedMinor,
    employerCostClass: f.componentType === "employer_cost" && f.employerCostClass !== "" ? f.employerCostClass : null,
    costPlacement: f.componentType === "employer_cost" ? f.costPlacement : "inside_ctc",
    countsForPfWage: template && f.countsForPfWage, countsForEsiWage: template && f.countsForEsiWage,
    countsForGratuity: template && f.countsForGratuity, lopApplicable: template && f.lopApplicable,
  };
  if (isNew) payload.code = code;
  return { ok: true, payload };
}

/** A stored component, in the shape GET /v1/payroll/structures/:id/components returns. */
export interface ComponentRow {
  id: string; code: string; name: string; componentType: string; isTaxable: boolean; isActive: boolean;
  calc: string | null; pctOfBasic: number | null; pctOfCtcBps: number | null; fixedMinor: string | null;
  employerCostClass: string | null; costPlacement: string; countsForPfWage: boolean; countsForEsiWage: boolean;
  countsForGratuity: boolean; lopApplicable: boolean; payslipOrder: number | null; version: number;
}

export function formFromRow(r: ComponentRow): ComponentForm {
  const paise = r.fixedMinor ? BigInt(r.fixedMinor) : null;
  const rupees = paise === null ? "" : `${paise / 100n}${paise % 100n === 0n ? "" : "." + String(paise % 100n).padStart(2, "0")}`;
  const calc = (r.calc ?? (r.pctOfBasic && r.pctOfBasic > 0 ? "pct_of_basic" : r.fixedMinor != null ? "fixed" : "")) as CalcType | "";
  return {
    code: r.code, name: r.name, componentType: r.componentType as ComponentForm["componentType"], calc,
    pctOfBasic: r.pctOfBasic != null ? String(r.pctOfBasic) : "", pctOfCtc: r.pctOfCtcBps != null ? String(r.pctOfCtcBps / 100) : "",
    fixedRupees: rupees, employerCostClass: (r.employerCostClass ?? "") as EmployerCostClass | "",
    costPlacement: r.costPlacement as CostPlacement, isTaxable: r.isTaxable, countsForPfWage: r.countsForPfWage,
    countsForEsiWage: r.countsForEsiWage, countsForGratuity: r.countsForGratuity, lopApplicable: r.lopApplicable,
  };
}
