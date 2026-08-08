import { describe, it, expect } from "vitest";
import {
  APPLICANT_TYPES,
  PROFILE_ATTRIBUTE_REGISTRY,
  assertAllowedApplicantTypesConfig,
  assertApplicantTypeAllowed,
  assertProfileAttributeBindings,
  attributesForTypes,
  coerceAllowedApplicantTypes,
  normalizeApplicantType,
  ApplicantTypeRejectedError,
} from "./domain.js";

describe("FN-23 applicant identity types", () => {
  it("exposes the four BRD applicant types", () => {
    expect([...APPLICANT_TYPES]).toEqual(["citizen", "company", "institution", "anonymous"]);
  });

  it("normalises individual/org aliases onto canonical types", () => {
    expect(normalizeApplicantType("individual")).toBe("citizen");
    expect(normalizeApplicantType("ORG")).toBe("company");
    expect(normalizeApplicantType("institution")).toBe("institution");
    expect(normalizeApplicantType("anon")).toBe("anonymous");
    expect(normalizeApplicantType("unknown")).toBeNull();
  });

  it("rejects anonymous on non-grievance patterns", () => {
    expect(() =>
      assertAllowedApplicantTypesConfig(["citizen", "anonymous"], "certificate"),
    ).toThrow("ANONYMOUS_GRIEVANCE_ONLY");
    expect(() =>
      assertAllowedApplicantTypesConfig(["citizen", "anonymous"], "grievance"),
    ).not.toThrow();
  });

  it("company-only service rejects citizen profile with configured message", () => {
    expect(() =>
      assertApplicantTypeAllowed({
        allowedApplicantTypes: ["company"],
        applicantType: "citizen",
        rejectMessage: "Trade Licence accepts company applicants only.",
      }),
    ).toThrow(ApplicantTypeRejectedError);

    try {
      assertApplicantTypeAllowed({
        allowedApplicantTypes: ["company"],
        applicantType: "citizen",
        rejectMessage: "Trade Licence accepts company applicants only.",
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ApplicantTypeRejectedError);
      expect((e as ApplicantTypeRejectedError).rejectMessage).toBe(
        "Trade Licence accepts company applicants only.",
      );
      expect((e as ApplicantTypeRejectedError).code).toBe("APPLICANT_TYPE_NOT_ALLOWED");
    }
  });

  it("allows a matching applicant type", () => {
    expect(() =>
      assertApplicantTypeAllowed({
        allowedApplicantTypes: ["company", "institution"],
        applicantType: "company",
      }),
    ).not.toThrow();
  });

  it("binds profile attributes from the registry for selected types", () => {
    const attrs = attributesForTypes(["company"]);
    expect(attrs.map((a) => a.key)).toEqual(
      expect.arrayContaining(["gstin", "cin", "orgName", "mobile", "email"]),
    );
    expect(attrs.every((a) => a.applicantTypes.includes("company"))).toBe(true);
    expect(PROFILE_ATTRIBUTE_REGISTRY.length).toBeGreaterThan(5);
  });

  it("validates profile attribute bindings against allowed types", () => {
    expect(() =>
      assertProfileAttributeBindings(
        [{ attributeKey: "gstin", applicantType: "company", required: true }],
        ["company"],
      ),
    ).not.toThrow();

    expect(() =>
      assertProfileAttributeBindings(
        [{ attributeKey: "gstin", applicantType: "citizen", required: true }],
        ["citizen"],
      ),
    ).toThrow(/PROFILE_ATTR_TYPE_MISMATCH|PROFILE_ATTR_TYPE_NOT_ALLOWED/);
  });

  it("coerces legacy empty config to citizen-only", () => {
    expect(coerceAllowedApplicantTypes(null)).toEqual(["citizen"]);
    expect(coerceAllowedApplicantTypes([])).toEqual(["citizen"]);
    expect(coerceAllowedApplicantTypes(["individual", "company"])).toEqual(["citizen", "company"]);
  });
});
