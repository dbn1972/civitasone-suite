/**
 * PAY-PROFILES: pure report/preflight builders over the HRMS payroll-input
 * feed + pay plans. No I/O here (routes.ts loads the inputs).
 */
import type { PayrollInputEmployee } from "../../shared/hrms-client.js";
import { govtHraMinor, hraSlabPct, isPayrollEligible, type CityClass } from "../payroll/domain.js";
import type { AllowanceRules } from "./allowance-rules.js";
import { planEmployeePay } from "./plan.js";
import { DEFAULT_SUBSISTENCE_CONFIG, resolveProfiledSuspension } from "../payroll/subsistence.js";

type FeedEmployee = PayrollInputEmployee & { paymentRoute?: string; eligibleForPayroll?: boolean };

export interface HraFloorImpactRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  payProfile: string;
  cityClass: CityClass;
  basicMinor: string;
  daRateBps: string;
  slabPct: string;
  slabHraMinor: string;
  floorMinor: string;
  hraMinor: string;
  monthlyIncreaseMinor: string;
}

/**
 * Employees whose government-scale HRA for `month` rises because of the
 * floor: HRA = max(slab, floor) > slab. `floors` lets an administrator
 * preview candidate floors before configuring them; otherwise the effective
 * rules are used. Basic follows the run exactly (latest payroll revision,
 * else the pay profile's basic).
 */
export function hraFloorImpact(
  employees: FeedEmployee[],
  month: string,
  centralDaRateBps: bigint,
  rules: AllowanceRules,
  revisedBasic: Map<string, bigint>,
  floors?: Partial<Record<CityClass, bigint>>,
): { rows: HraFloorImpactRow[]; totalMonthlyIncreaseMinor: string; employeesConsidered: number } {
  const rows: HraFloorImpactRow[] = [];
  let considered = 0;
  let total = 0n;
  for (const emp of employees) {
    if (!isPayrollEligible(emp)) continue;
    const planned = planEmployeePay(emp, month, centralDaRateBps, rules);
    if (!planned.ok) continue;
    const plan = planned.plan;
    if (plan.profile === "consolidated_contract") continue;
    considered += 1;
    const cityClass = emp.cityClass ?? "X";
    const floor = floors?.[cityClass] ?? rules.hraFloorMinor[cityClass];
    const basic = (plan.applyRevisions ? revisedBasic.get(emp.id) : undefined) ?? plan.profileBasicMinor;
    const slab = govtHraMinor(basic, cityClass, plan.daRateBps);
    const hra = govtHraMinor(basic, cityClass, plan.daRateBps, floor);
    if (hra <= slab) continue;
    total += hra - slab;
    rows.push({
      employeeId: emp.id, employeeNo: emp.employeeNo, fullName: emp.fullName, payProfile: plan.profile,
      cityClass, basicMinor: basic.toString(), daRateBps: plan.daRateBps.toString(),
      slabPct: hraSlabPct(cityClass, plan.daRateBps).toString(),
      slabHraMinor: slab.toString(), floorMinor: floor.toString(), hraMinor: hra.toString(),
      monthlyIncreaseMinor: (hra - slab).toString(),
    });
  }
  rows.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
  return { rows, totalMonthlyIncreaseMinor: total.toString(), employeesConsidered: considered };
}

export interface PreflightIssue {
  employeeId: string;
  employeeNo: string;
  severity: "blocking" | "warning";
  code: string;
  message: string;
}

/**
 * What would stop (blocking) or deserves a look before (warning) a salary run
 * for `month`: every pay-plan failure the run itself would raise, a profile
 * change inside the month, an Option A allowance paid at the fixed amount
 * because no rule is configured, and HRMS's own pay-profile advisories.
 */
export function payrollPreflight(
  employees: FeedEmployee[],
  month: string,
  centralDaRateBps: bigint,
  rules: AllowanceRules,
  /** Latest salary-revision effective date (YYYY-MM-DD) per employee, when known. */
  revisionEffective: Map<string, string> = new Map(),
): { blocking: number; warnings: number; issues: PreflightIssue[] } {
  const issues: PreflightIssue[] = [];
  if (!Object.values(rules.hraFloorMinor).some((f) => f > 0n)) {
    issues.push({
      employeeId: "", employeeNo: "", severity: "warning", code: "HRA_FLOOR_NOT_CONFIGURED",
      message: `no HRA minimum floor is configured for ${month}; government-scale HRA will be the plain slab. Review report:hra-floor-impact, then set it (payroll:set-hra-floor / POST /v1/payroll/allowance-rules)`,
    });
  }
  for (const emp of employees) {
    if (!isPayrollEligible(emp)) continue;
    const ref = { employeeId: emp.id, employeeNo: emp.employeeNo };
    // Same order as the run: a suspended employee the run WITHHOLDS (an
    // assigned consolidated / ctc profile, or #1782's engagement rule) never
    // reaches the pay plan, so it is a warning here, never blocking. Whether
    // a month is withheld depends only on the dates and the profile, not on
    // the tenant's subsistence percentages, so the FR 53 defaults suffice.
    const suspension = resolveProfiledSuspension(emp, month, DEFAULT_SUBSISTENCE_CONFIG);
    if (suspension.kind === "withhold") {
      issues.push({ ...ref, severity: "warning", code: "SUSPENDED_PAY_WITHHELD", message: `suspended; this month's pay will be withheld and flagged (${suspension.flags.join(", ")})` });
      continue;
    }
    const planned = planEmployeePay(emp, month, centralDaRateBps, rules);
    if (!planned.ok) {
      issues.push({ ...ref, severity: "blocking", code: planned.code, message: planned.message });
      continue;
    }
    if (emp.payProfile?.changedWithinMonth) {
      issues.push({ ...ref, severity: "warning", code: "PROFILE_CHANGED_WITHIN_MONTH", message: "pay profile changes inside the month; v1 pays the whole month under the profile in force on the 1st -- raise a manual arrear for the difference" });
    }
    const dep = emp.payProfile?.deputation;
    if (planned.plan.profile === "deputation_parent_scale" && dep?.allowanceMode === "auto" && planned.plan.snapshot.allowanceBasis === "fixed") {
      issues.push({ ...ref, severity: "warning", code: "DEPUTATION_ALLOWANCE_RULE_NOT_CONFIGURED", message: `no deputation-allowance rule configured for ${dep.stationType ?? "unknown"}-station; paying the fixed amount on the deputation order` });
    }
    const rev = revisionEffective.get(emp.id);
    if (planned.plan.arrearDaBasis === "plan_rate" && rev && rev.slice(0, 7) < month) {
      issues.push({ ...ref, severity: "warning", code: "PARENT_DA_ARREARS_AT_CURRENT_RATE", message: `back-dated revision (${rev}) for a parent-State-DA deputationist: retro arrears are priced at the current parent DA rate; if the parent DA changed in between, raise a manual arrear` });
    }
    for (const a of emp.advisories ?? []) {
      issues.push({ ...ref, severity: "warning", code: a, message: `HRMS pay-profile advisory: ${a}` });
    }
  }
  return {
    blocking: issues.filter((i) => i.severity === "blocking").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    issues,
  };
}

export interface ForeignServiceRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  payProfile: string;
  parentOrganisation: string | null;
  parentCadre: string;
  option: string | null;
  tenureFrom: string;
  tenureTo: string;
  slipFound: boolean;
  basicMinor: string | null;
  daMinor: string | null;
  /** Basic + DA for the month: the base the parent's contribution tables apply to. */
  contributionBaseMinor: string | null;
}

/**
 * Foreign-service deputationists for `month` with the pay actually drawn
 * (from that month's slip when one exists). FLAG-AND-REPORT ONLY: pension /
 * leave-salary contribution RATES (FR 116/117 tables) are not computed and
 * nothing is posted to finance.
 */
export function foreignServiceReport(
  employees: FeedEmployee[],
  slips: Map<string, { basicMinor: bigint; components: Array<{ code: string; amountMinor: number }> }>,
): ForeignServiceRow[] {
  const rows: ForeignServiceRow[] = [];
  for (const emp of employees) {
    const dep = emp.payProfile?.deputation;
    if (!dep?.foreignService) continue;
    const slip = slips.get(emp.id);
    const da = slip ? slip.components.filter((c) => c.code === "DA").reduce((s, c) => s + BigInt(c.amountMinor), 0n) : null;
    rows.push({
      employeeId: emp.id, employeeNo: emp.employeeNo, fullName: emp.fullName,
      payProfile: emp.payProfile?.profile ?? "govt_scale",
      parentOrganisation: dep.parentOrganisation, parentCadre: dep.parentCadre, option: dep.option,
      tenureFrom: dep.tenureFrom, tenureTo: dep.tenureTo,
      slipFound: slip != null,
      basicMinor: slip ? slip.basicMinor.toString() : null,
      daMinor: da != null ? da.toString() : null,
      contributionBaseMinor: slip && da != null ? (slip.basicMinor + da).toString() : null,
    });
  }
  rows.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
  return rows;
}
