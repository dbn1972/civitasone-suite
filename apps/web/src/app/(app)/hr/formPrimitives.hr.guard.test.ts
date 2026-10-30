import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * SF-14b guard. Path-scoped, no baseline: the HR forms below were converted to the ds form primitives
 * (`Field` + `Input`/`Select`/`Textarea`) and must not regress to a bare control. A bare `<input>`/`<select>`/
 * `<textarea>`/`<label>` loses the htmlFor/id link, aria-invalid, aria-describedby and required marking `Field` wires.
 *
 * Allowed: `<input type="radio|checkbox|hidden">`, and a `<label>` only when it wraps such a radio/checkbox.
 * Extend HR_CONVERTED in the same PR that converts another HR form (SF-14c).
 */
const HR = __dirname;

const HR_CONVERTED = [
  "_components/ShiftChangeRequestForm.tsx",
  "_components/WFHRequestForm.tsx",
  "advances/RequestAdvanceForm.tsx",
  "attendance/regularisation/RaiseRegularisation.tsx",
  "benefits/_components/ElectionForm.tsx",
  "confirmation/_components/ProbationConfirmationCard.tsx",
  "contractual/[id]/ContractActions.tsx",
  "departments/new/AddDepartmentForm.tsx",
  "disciplinary/[id]/_components/CaseActions.tsx",
  "expenses/NewExpenseClaimForm.tsx",
  "goals/_components/GoalTrackerCard.tsx",
  "grievance/[id]/GrievanceActions.tsx",
  "grievance/new/NewGrievanceForm.tsx",
  "holidays/AddHolidayForm.tsx",
  "jd-templates/new/NewTemplateForm.tsx",
  "leave-policies/CreateLeavePolicyForm.tsx",
  "leave-policies/HalfDayLeaveSettings.tsx",
  "leave/allocate/AllocateLeaveForm.tsx",
  "leave/apply/ApplyLeaveForm.tsx",
  "locations/new/AddLocationForm.tsx",
  "medical/_components/MedicalInsuranceForm.tsx",
  "medical/new/NewMedicalClaimForm.tsx",
  "office-locations/OfficeLocationForm.tsx",
  "onboarding/_components/AddTaskForm.tsx",
  "onboarding/_components/ApplyTemplateCard.tsx",
  "outsourced/OutsourcedRegister.tsx",
  "overtime/new/OvertimeNewForm.tsx", // the form moved here when page.tsx became a role-gating Server Component (GAP-HR-OVERTIME-NEW-02)
  "overtime/new/page.tsx",
  "payroll/form16/Form16Wizard.tsx",
  "promotion/PromoteWithApproval.tsx",
  "retirement/_components/InitiateSeparationAction.tsx",
  "succession/_components/CreatePlanForm.tsx",
  "transfer/TransferWithApproval.tsx",
  "travel/TravelRequestForm.tsx",
];

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
const CHOICE_INPUT = /<input\b[^>]*\btype\s*=\s*\{?["'`](?:radio|checkbox|hidden)/;

/** Bare-control violations in one source file. */
function bareControls(raw: string): string[] {
  const src = stripComments(raw);
  const out: string[] = [];
  // Inputs: every <input ...> element must be a radio/checkbox/hidden.
  for (const m of src.matchAll(/<input\b[\s\S]*?\/>/g)) {
    if (!CHOICE_INPUT.test(m[0])) out.push(`bare <input>: ${m[0].slice(0, 60).replace(/\s+/g, " ")}`);
  }
  for (const m of src.matchAll(/<(select|textarea)\b/g)) out.push(`bare <${m[1]}>`);
  // Labels: only a wrapping label around a radio/checkbox is allowed.
  for (const m of src.matchAll(/<label\b[\s\S]*?<\/label>/g)) {
    if (!CHOICE_INPUT.test(m[0])) out.push(`bare <label>: ${m[0].slice(0, 60).replace(/\s+/g, " ")}`);
  }
  return out;
}

describe("SF-14b guard: converted HR forms use ds Field, not bare controls", () => {
  it("flags the known-bad patterns (self-test)", () => {
    expect(bareControls('<label htmlFor="a">A</label><input id="a" />').length).toBe(2);
    expect(bareControls("<select><option/></select>").length).toBe(1);
    expect(bareControls("<textarea />").length).toBe(1);
    expect(bareControls('<label><input type="checkbox" /> x</label><input type="hidden" />')).toEqual([]);
    expect(bareControls('<Field label="A"><Input /></Field>')).toEqual([]);
  });
  it.each(HR_CONVERTED)("%s has no bare control", (rel) => {
    expect(bareControls(readFileSync(path.join(HR, rel), "utf8"))).toEqual([]);
  });
  it("converted forms that use Field import it from the ds barrel", () => {
    for (const rel of HR_CONVERTED) {
      const src = stripComments(readFileSync(path.join(HR, rel), "utf8"));
      if (/<Field\b/.test(src)) expect(src, rel).toMatch(/\bField\b[^;]*from\s+["'][^"']*_components\/ds["']/);
    }
  });
});
