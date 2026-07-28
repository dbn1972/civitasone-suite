/**
 * Screening domain — decision/reason vocab, auto-screen mapping, rejection-reason
 * rule, and blind-screening redaction.
 */
import { describe, it, expect } from "vitest";
import {
  autoScreenDecision, requiresRejectionReason, redactApplicant,
  isScreeningDecision, isRejectionReasonCode, PROTECTED_FIELDS,
} from "../src/modules/recruitment/screening.js";

describe("autoScreenDecision", () => {
  it("maps a stored eligibility result to eligible/ineligible, else pending", () => {
    expect(autoScreenDecision({ eligible: true })).toBe("eligible");
    expect(autoScreenDecision({ eligible: false })).toBe("ineligible");
    expect(autoScreenDecision(null)).toBe("pending");
    expect(autoScreenDecision({})).toBe("pending");        // never evaluated
    expect(autoScreenDecision(undefined)).toBe("pending");
  });
});

describe("requiresRejectionReason", () => {
  it("requires a reason only for a rejection (ineligible)", () => {
    expect(requiresRejectionReason("ineligible")).toBe(true);
    expect(requiresRejectionReason("shortlisted")).toBe(false);
    expect(requiresRejectionReason("waitlisted")).toBe(false);
    expect(requiresRejectionReason("eligible")).toBe(false);
  });
});

describe("vocab guards", () => {
  it("validates decisions and reason codes", () => {
    expect(isScreeningDecision("shortlisted")).toBe(true);
    expect(isScreeningDecision("nope")).toBe(false);
    expect(isRejectionReasonCode("incomplete_documents")).toBe(true);
    expect(isRejectionReasonCode("vibes")).toBe(false);
  });
});

describe("redactApplicant (blind screening)", () => {
  it("removes every protected attribute and keeps merit fields", () => {
    const row = {
      id: "x", applicantName: "Asha", email: "a@x.in", mobile: "999", category: "OBC",
      dateOfBirth: "1998-01-01", gender: "female",
      qualification: "B.Tech", experienceYears: 5, skills: ["go"], screeningDecision: "pending",
    };
    const r = redactApplicant(row);
    for (const f of PROTECTED_FIELDS) expect(r).not.toHaveProperty(f);
    expect(r.qualification).toBe("B.Tech");
    expect(r.experienceYears).toBe(5);
    expect(r.id).toBe("x");
  });
});
