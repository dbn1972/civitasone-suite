import { describe, it, expect } from "vitest";
import { resolveAndGateApplicantType, ApplicantTypeRejectedError } from "./intake-domain.js";

describe("intake FN-23 applicant type gate", () => {
  it("defaults omitted type to citizen and allows citizen-only services", () => {
    expect(
      resolveAndGateApplicantType({
        allowedApplicantTypes: ["citizen"],
      }),
    ).toBe("citizen");
  });

  it("rejects citizen against company-only with configured message", () => {
    expect(() =>
      resolveAndGateApplicantType({
        rawApplicantType: "citizen",
        allowedApplicantTypes: ["company"],
        rejectMessage: "Company applicants only.",
      }),
    ).toThrow(ApplicantTypeRejectedError);

    try {
      resolveAndGateApplicantType({
        rawApplicantType: "individual",
        allowedApplicantTypes: ["company"],
        rejectMessage: "Company applicants only.",
      });
    } catch (e) {
      expect((e as ApplicantTypeRejectedError).rejectMessage).toBe("Company applicants only.");
    }
  });

  it("normalises org alias to company when allowed", () => {
    expect(
      resolveAndGateApplicantType({
        rawApplicantType: "org",
        allowedApplicantTypes: ["company", "institution"],
      }),
    ).toBe("company");
  });
});
