import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildSampleSubjectFields,
  evaluateEligibilityLocal,
  persistEligibilityDesign,
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

  // GAP-DESIGNER-DETAIL-B3-03: 'warn' must survive a save+reload instead of
  // silently collapsing to 'flag' (both previously mapped to 'refer').
  it("round-trips warn and flag effects distinctly", () => {
    const rules: EligibilityRuleUi[] = [
      { id: "r1", attribute: "age", op: "gte", value: "18", effect: "warn", message: "Please verify age" },
      { id: "r2", attribute: "ward", op: "exists", effect: "flag", message: "Verify ward" },
    ];
    const api = rulesUiToApi(rules);
    expect(api[0]?.effect).toBe("warn");
    expect(api[1]?.effect).toBe("refer");
    const back = rulesApiToUi(api);
    expect(back[0]?.effect).toBe("warn");
    expect(back[1]?.effect).toBe("flag");
  });

  it("loads legacy 'refer' rules as 'flag' for backward compatibility", () => {
    const back = rulesApiToUi([
      { id: "r1", attribute: "ward", op: "exists", effect: "refer", label: "legacy" },
    ]);
    expect(back[0]?.effect).toBe("flag");
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

/**
 * UX-016: persistEligibilityDesign's parseJson used to throw the raw
 * response body text (or a `Request failed (${status})` fallback) —
 * the same class of leak useFormError closes for components (UX-003).
 * This module is a plain async data client, not a component, so it can't
 * use that hook; it now goes through the same catalogued toHumanError
 * vocabulary instead and never reads the response body at all, so it
 * structurally cannot leak it.
 */
describe("eligibilityBuilderApi — persistEligibilityDesign never leaks raw status or server text", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("throws a clerk-safe message, never the raw HTTP status or server text, when creating a rule set fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "eligibility-service unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const err = await persistEligibilityDesign(
      { name: "Eligibility", rules: [] },
      "svc-1",
      "Trade License",
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b503\b/);
    expect(message).not.toContain("eligibility-service unavailable");
    expect(message).toMatch(/couldn't save/i);
  });

  it("throws the same clerk-safe message when updating an existing rule set fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));

    const err = await persistEligibilityDesign(
      { ruleSetId: "rs-1", name: "Eligibility", rules: [] },
      "svc-1",
      "Trade License",
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });
});

/**
 * GAP-DESIGNER-DETAIL-B3-01: sensitive socio-economic attributes carry sensitivity metadata.
 */
import { PROFILE_ATTRIBUTES } from "@/app/_components/ds/designer/eligibilityTypes";

describe("PROFILE_ATTRIBUTES sensitivity (GAP-DESIGNER-DETAIL-B3-01)", () => {
  it("bpl and income_band carry sensitivity='sensitive'", () => {
    const bpl = PROFILE_ATTRIBUTES.find((a) => a.id === "bpl");
    expect(bpl?.sensitivity).toBe("sensitive");
    const income = PROFILE_ATTRIBUTES.find((a) => a.id === "income_band");
    expect(income?.sensitivity).toBe("sensitive");
  });

  it("non-sensitive attributes do not carry the flag", () => {
    const age = PROFILE_ATTRIBUTES.find((a) => a.id === "age");
    expect(age?.sensitivity).toBeUndefined();
  });
});
