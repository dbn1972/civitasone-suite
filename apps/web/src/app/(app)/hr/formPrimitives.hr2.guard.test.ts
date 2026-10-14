import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * SF-14c guard (part 2 of the HR form-primitive migration; part 1 is formPrimitives.hr.guard.test.ts).
 * Path-scoped, no baseline: the HR / payroll / recruitment forms below were converted to the ds form
 * primitives (`Field` + `Input`/`Select`/`Textarea`) and must not regress to a bare control. A bare
 * `<input>`/`<select>`/`<textarea>`/`<label>` loses the htmlFor/id link, aria-invalid, aria-describedby and
 * required marking `Field` wires.
 *
 * Allowed: `<input type="radio|checkbox|hidden">`, and a `<label>` only when it wraps such a radio/checkbox.
 * Extend HR2_CONVERTED in the same PR that converts another HR form (SF-14d).
 */
const HR = __dirname;

const HR2_CONVERTED = [
  "employee-types/_components/EmployeeTypeForm.tsx",
  "employees/[id]/edit/EditEmployeeForm.tsx",
  "employees/import/ImportForm.tsx",
  "employees/new/steps/Step1.tsx",
  "employees/new/steps/Step2.tsx",
  "employees/new/steps/Step3.tsx",
  "employees/new/steps/Step4.tsx",
  "payroll/CreatePayrollRunForm.tsx",
  "payroll/bonus/ComputeBonusForm.tsx",
  "payroll/corrections/CreateCorrectionForm.tsx",
  "payroll/costing/CostingPeriodForm.tsx",
  "payroll/costing/CreateCostingRuleForm.tsx",
  "payroll/ctc/CtcCalculatorForm.tsx",
  "payroll/ddos/CreateDdoForm.tsx",
  "payroll/disbursement/NachMandateForm.tsx",
  "payroll/disbursement/NachReturnForm.tsx",
  "payroll/flex-benefits/CreateFlexPlanForm.tsx",
  "payroll/fnf/ComputeFnfForm.tsx",
  "payroll/form16/FyLookupForm.tsx",
  "payroll/form16/VerifyForm16Form.tsx",
  "payroll/loans/CreateLoanForm.tsx",
  "payroll/off-cycle/CreateOffCycleForm.tsx",
  "payroll/pay-groups/CreatePayGroupForm.tsx",
  "payroll/pensioners/new/CreatePensionerForm.tsx",
  "payroll/reimbursements/CreateReimbursementForm.tsx",
  "payroll/returns/QuarterLookupForm.tsx",
  "payroll/returns/RecordFilingForm.tsx",
  "payroll/salary-revisions/CreateSalaryRevisionForm.tsx",
  "payroll/statutory/lwf/LwfConfigForm.tsx",
  "payroll/structures/CreateStructureForm.tsx",
  "payroll/tax-declaration/TaxDeclarationForm.tsx",
  "recruitment/[id]/_components/ApplicationFeeDialog.tsx",
  "recruitment/[id]/_components/OfferWorkflowDialog.tsx",
  "recruitment/_components/GOIReservationCard.tsx",
  "recruitment/_components/VacancyNotificationPanel.tsx",
  "recruitment/requisitions/RequisitionsClient.tsx",
  "recruitment/settings/page.tsx",
];

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
const CHOICE_INPUT = /<input\b[^>]*\btype\s*=\s*\{?["'`](?:radio|checkbox|hidden)/;

/** Bare-control violations in one source file. */
function bareControls(raw: string): string[] {
  const src = stripComments(raw);
  const out: string[] = [];
  for (const m of src.matchAll(/<input\b[\s\S]*?\/>/g)) {
    if (!CHOICE_INPUT.test(m[0])) out.push(`bare <input>: ${m[0].slice(0, 60).replace(/\s+/g, " ")}`);
  }
  for (const m of src.matchAll(/<(select|textarea)\b/g)) out.push(`bare <${m[1]}>`);
  for (const m of src.matchAll(/<label\b[\s\S]*?<\/label>/g)) {
    if (!CHOICE_INPUT.test(m[0])) out.push(`bare <label>: ${m[0].slice(0, 60).replace(/\s+/g, " ")}`);
  }
  return out;
}

describe("SF-14c guard: converted HR/payroll/recruitment forms use ds Field, not bare controls", () => {
  it("flags the known-bad patterns (self-test)", () => {
    expect(bareControls('<label htmlFor="a">A</label><input id="a" />').length).toBe(2);
    expect(bareControls("<select><option/></select>").length).toBe(1);
    expect(bareControls("<textarea />").length).toBe(1);
    expect(bareControls('<label><input type="checkbox" /> x</label><input type="hidden" />')).toEqual([]);
    expect(bareControls('<Field label="A"><Input /></Field>')).toEqual([]);
  });
  it.each(HR2_CONVERTED)("%s has no bare control", (rel) => {
    expect(bareControls(readFileSync(path.join(HR, rel), "utf8"))).toEqual([]);
  });
  it("converted forms that use Field import it from the ds barrel", () => {
    for (const rel of HR2_CONVERTED) {
      const src = stripComments(readFileSync(path.join(HR, rel), "utf8"));
      if (/<Field\b/.test(src)) expect(src, rel).toMatch(/\bField\b[^;]*from\s+["'][^"']*_components\/ds["']/);
    }
  });
});
