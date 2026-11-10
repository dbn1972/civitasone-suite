/**
 * Section 8 gap G1: the DB-facing glue of the CTC engine (reads only; every write stays in the run consumer).
 * Templates are read ONLY through G2's resolveTemplateForMonth, so an unlocked draft, a run structure or a
 * version that does not yet take effect can never drive a slip.
 */
import type { PayrollInputEmployee } from "../../shared/hrms-client.js";
import type { EarningsOverride, StatutoryConfig } from "../payroll/domain.js";
import type { ComponentRowView } from "../pay-components/api.js";
import { effectiveCalc } from "../pay-components/api.js";
import { resolveTemplateForMonth } from "../pay-components/rules.js";
import type { CtcPaidMonth, CtcPlan, CtcPlanContext, CtcResolvedTemplate, CtcTemplateLine } from "./model.js";

type Tx = Parameters<typeof resolveTemplateForMonth>[0];

/** A G2 component row as an engine template line. */
export function templateLineFromRow(c: ComponentRowView): CtcTemplateLine {
  return {
    code: c.code, name: c.name,
    componentType: c.componentType === "employer_cost" ? "employer_cost" : "earning",
    calc: effectiveCalc(c),
    pctOfBasic: c.pctOfBasic, pctOfCtcBps: c.pctOfCtcBps,
    fixedMinor: c.fixedMinor != null ? BigInt(c.fixedMinor) : null,
    employerCostClass: (c.employerCostClass as CtcTemplateLine["employerCostClass"]) ?? null,
    costPlacement: (c.costPlacement as CtcTemplateLine["costPlacement"]) ?? "inside_ctc",
    countsForPfWage: c.countsForPfWage, countsForEsiWage: c.countsForEsiWage, countsForGratuity: c.countsForGratuity,
    lopApplicable: c.lopApplicable, payslipOrder: c.payslipOrder,
  };
}

/** The distinct template lineages the run's ctc_contract employees point at. */
export function ctcLineageIds(employees: ReadonlyArray<Pick<PayrollInputEmployee, "payProfile">>): string[] {
  const ids = new Set<string>();
  for (const e of employees) {
    const ctc = e.payProfile?.profile === "ctc_contract" ? e.payProfile.ctc : undefined;
    if (ctc) ids.add(ctc.templateLineageId);
  }
  return [...ids].sort();
}

/** Resolve (once per lineage) the locked template in force for the run month. */
export async function buildCtcPlanContext(
  tx: Tx, tenantId: string, employees: ReadonlyArray<Pick<PayrollInputEmployee, "payProfile">>, month: string, cfg: StatutoryConfig,
): Promise<CtcPlanContext> {
  const templates = new Map<string, CtcResolvedTemplate | null>();
  for (const lineageId of ctcLineageIds(employees)) {
    const r = await resolveTemplateForMonth(tx, tenantId, lineageId, month);
    templates.set(lineageId, r ? { structureId: r.structureId, templateVersion: r.templateVersion, effectiveFrom: r.effectiveFrom, lines: r.components.map(templateLineFromRow) } : null);
  }
  return { templates, cfg };
}

/** The paid month as computeSlip's earningsOverride: pre-built earning lines, no DA, PF wage = flagged earnings. */
export function ctcEarningsOverride(paid: CtcPaidMonth): EarningsOverride {
  return {
    components: paid.earnings.filter((e) => e.amountMinor > 0n).map((e) => ({ code: e.code, name: e.name, type: "earning" as const, amountMinor: e.amountMinor })),
    daMinor: 0n, hraMinor: paid.hraMinor, pensionBaseMinor: paid.pfWageMinor, hraSalaryMinor: paid.basicMinor,
  };
}

/** JSON-safe audit snapshot of the paid month, stored on the slip beside the plan snapshot. */
export function ctcPaidSnapshot(plan: CtcPlan, paid: CtcPaidMonth, days: { lopDays: number; notInServiceDays: number; daysInMonth: number }): Record<string, unknown> {
  const e = plan.expansion;
  return {
    ctc: {
      templateLineageId: plan.template.lineageId, templateStructureId: plan.template.structureId,
      templateVersion: plan.template.templateVersion, templateEffectiveFrom: plan.template.effectiveFrom,
      monthlyCtcMinor: e.monthlyCtcMinor.toString(), annualVariableTargetMinor: e.annualVariableTargetMinor?.toString() ?? null,
      epfWagePolicy: e.epfWagePolicy, esiApplies: e.esiApplies, unallocatedMinor: e.unallocatedMinor.toString(),
      fullMonth: e.earnings.map((l) => ({ code: l.code, amountMinor: l.amountMinor.toString(), source: l.source })),
      employerCostsFullMonth: e.employerCosts.map((l) => ({ code: l.code, class: l.employerCostClass, placement: l.costPlacement, amountMinor: l.amountMinor.toString() })),
      paid: {
        ...days,
        grossMinor: paid.grossMinor.toString(), pfWageMinor: paid.pfWageMinor.toString(),
        earnings: paid.earnings.map((l) => ({ code: l.code, amountMinor: l.amountMinor.toString() })),
        employerCosts: paid.employerCosts.map((l) => ({ code: l.code, class: l.employerCostClass, placement: l.costPlacement, amountMinor: l.amountMinor.toString() })),
        employerPfMinor: paid.employerPfMinor.toString(), employerEsiMinor: paid.employerEsiMinor.toString(), gratuityProvisionMinor: paid.gratuityMinor.toString(),
      },
    },
  };
}
