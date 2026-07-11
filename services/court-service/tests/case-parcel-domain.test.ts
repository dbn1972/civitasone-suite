/** Pure-domain tests for parcel id derivation, survey normalization, subjects. */
import { describe, it, expect } from "vitest";
import { deriveParcelId, normalizeSurvey, isValidSubjectType, SUBJECT_TYPES } from "../src/modules/case-parcel/domain.js";

describe("case-parcel domain — id derivation", () => {
  const t = "11111111-1111-1111-1111-111111111111";
  const c = "22222222-2222-2222-2222-222222222222";

  it("deriveParcelId is deterministic per (tenant, case, survey, khasra)", () => {
    expect(deriveParcelId(t, c, "12/3A", "45")).toBe(deriveParcelId(t, c, "12/3A", "45"));
  });

  it("is idempotent across survey-number formatting (trim + case)", () => {
    expect(deriveParcelId(t, c, " 12/3a ", "45")).toBe(deriveParcelId(t, c, "12/3A", "45"));
  });

  it("a different survey number yields a different id", () => {
    expect(deriveParcelId(t, c, "12/3A")).not.toBe(deriveParcelId(t, c, "99/1B"));
  });

  it("survey-only and survey+khasra are distinct parcels", () => {
    expect(deriveParcelId(t, c, "12/3A")).not.toBe(deriveParcelId(t, c, "12/3A", "45"));
  });
});

describe("case-parcel domain — helpers", () => {
  it("normalizeSurvey trims and upper-cases", () => {
    expect(normalizeSurvey("  12/3a ")).toBe("12/3A");
  });

  it("subject-type validation accepts the vocabulary and rejects unknowns", () => {
    for (const s of SUBJECT_TYPES) expect(isValidSubjectType(s)).toBe(true);
    expect(isValidSubjectType("land")).toBe(true);
    expect(isValidSubjectType("spaceship")).toBe(false);
  });
});
