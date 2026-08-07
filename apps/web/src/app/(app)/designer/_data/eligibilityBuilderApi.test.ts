import { describe, expect, it } from "vitest";
import {
  evaluateEligibilityLocal,
  rulesApiToUi,
  rulesUiToApi,
} from "./eligibilityBuilderApi";
import type { EligibilityRuleUi } from "@/app/_components/ds/designer/eligibilityTypes";

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
});
