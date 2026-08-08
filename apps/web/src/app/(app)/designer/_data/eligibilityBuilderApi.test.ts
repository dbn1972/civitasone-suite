import { describe, expect, it } from "vitest";
import {
  buildSampleSubjectFields,
  evaluateEligibilityLocal,
  rulesApiToUi,
  rulesUiToApi,
  subjectFromSampleValues,
  suggestFailingSampleValues,
  suggestPassingSampleValues,
} from "./eligibilityBuilderApi";
import type { EligibilityRuleUi } from "@/app/_components/ds/designer/eligibilityTypes";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";

describe("eligibilityBuilderApi", () => {
  it("maps UI effects to API effects", () => {
    const rules: EligibilityRuleUi[] = [
      { id: "r1", attribute: "age", op: "gte", value: "18", effect: "block", message: "Must be adult" },
      { id: "r2", attribute: "ward", op: "exists", effect: "flag", message: "Verify ward" },
    ];
    const api = rulesUiToApi(rules);
    expect(api[0]?.effect).toBe("disqualify");
    expect(api[1]?.effect).toBe("refer");
    const back = rulesApiToUi(api);
    expect(back[0]?.attribute).toBe("age");
    expect(back[1]?.effect).toBe("flag");
  });

  it("evaluates sample applicant locally", () => {
    const rules: EligibilityRuleUi[] = [
      { id: "age", attribute: "age", op: "gte", value: "60", effect: "block", message: "Senior only" },
    ];
    const pass = evaluateEligibilityLocal(rules, { age: 65 });
    expect(pass.outcome).toBe("eligible");
    const fail = evaluateEligibilityLocal(rules, { age: 40 });
    expect(fail.outcome).toBe("not_eligible");
  });

  it("groups sample fields and suggests pass/fail applicant values", () => {
    const formFields: FormFieldDefinition[] = [
      {
        id: "f1",
        apiName: "business_type",
        type: "picklist_single",
        label: "Business type",
        required: false,
        sectionId: "s1",
      },
    ];
    const rules: EligibilityRuleUi[] = [
      { id: "r1", attribute: "age", op: "gte", value: "60", effect: "block", message: "Senior only" },
      { id: "r2", attribute: "business_type", op: "eq", value: "shop", effect: "flag", message: "Shop preferred" },
    ];
    const fields = buildSampleSubjectFields(rules, formFields);
    expect(fields.find((f) => f.id === "age")?.group).toBe("profile");
    expect(fields.find((f) => f.id === "business_type")?.group).toBe("form");

    const passVals = suggestPassingSampleValues(rules, formFields);
    const passSubject = subjectFromSampleValues(fields, passVals);
    expect(evaluateEligibilityLocal(rules, passSubject).outcome).toBe("eligible");

    const failVals = suggestFailingSampleValues(rules, formFields);
    const failSubject = subjectFromSampleValues(fields, failVals);
    expect(evaluateEligibilityLocal(rules, failSubject).outcome).toBe("not_eligible");
  });
});
