/**
 * Candidate domain — identity normalisation, field-lock, consent, completeness.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeEmail, normalizeMobile, mobileDedupKey, isFieldLocked, lockedFieldsIn, consentSatisfied, profileCompleteness,
} from "../src/modules/recruitment/candidate.js";

describe("identity normalisation (duplicate keys)", () => {
  it("lower-cases/trims email and takes the last 10 mobile digits", () => {
    expect(normalizeEmail(" John.Doe@X.IN ")).toBe("john.doe@x.in");
    expect(normalizeMobile("+91 98765-43210")).toBe("9876543210");
    expect(normalizeMobile("09876543210")).toBe("9876543210");
    expect(normalizeMobile("98765 43210")).toBe("9876543210");
  });
  it("mobileDedupKey returns a key only for a real 10-digit number, else null", () => {
    expect(mobileDedupKey("+91 98765 43210")).toBe("9876543210");
    expect(mobileDedupKey("N/A")).toBeNull();     // garbage -> no dedup key (no false collision)
    expect(mobileDedupKey("-")).toBeNull();
    expect(mobileDedupKey("12345")).toBeNull();   // too short
    expect(mobileDedupKey("")).toBeNull();
    expect(mobileDedupKey(undefined)).toBeNull();
  });
});

describe("field-lock after submission (R-RA-0089)", () => {
  it("locks eligibility-critical fields once submitted, keeps contact editable", () => {
    expect(isFieldLocked("submitted", "dateOfBirth")).toBe(true);
    expect(isFieldLocked("submitted", "category")).toBe(true);
    expect(isFieldLocked("submitted", "correspondenceAddress")).toBe(false);
    expect(isFieldLocked("draft", "dateOfBirth")).toBe(false); // nothing locked in draft
  });
  it("reports which requested fields are locked", () => {
    expect(lockedFieldsIn("submitted", ["dateOfBirth", "correspondenceAddress", "category"]).sort())
      .toEqual(["category", "dateOfBirth"]);
    expect(lockedFieldsIn("draft", ["dateOfBirth", "category"])).toEqual([]);
  });
});

describe("consent (R-RA-0090)", () => {
  it("requires an accepted, versioned consent", () => {
    expect(consentSatisfied({ consentAccepted: true, consentVersion: "v1.2" })).toBe(true);
    expect(consentSatisfied({ consentAccepted: true })).toBe(false);          // no version
    expect(consentSatisfied({ consentAccepted: false, consentVersion: "v1" })).toBe(false);
    expect(consentSatisfied({ consentVersion: "" , consentAccepted: true })).toBe(false);
  });
});

describe("profileCompleteness", () => {
  it("scores 0-100 across the key sections", () => {
    expect(profileCompleteness({ educationCount: 0, employmentCount: 0 })).toBe(0);
    expect(profileCompleteness({
      fullName: "A", dateOfBirth: "2000-01-01", email: "a@x.in", mobile: "9", category: "GEN",
      educationCount: 1, employmentCount: 1, activeResume: "r",
    })).toBe(100);
    expect(profileCompleteness({ fullName: "A", email: "a@x.in", educationCount: 0, employmentCount: 0 })).toBe(25);
  });
});
