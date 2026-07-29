/**
 * R-RA-0111 — screening override maker-checker domain (pure).
 */
import { describe, it, expect } from "vitest";
import {
  validateOverrideRequest, sodViolationForApprover, isActionable, OVERRIDE_STATUSES,
} from "../src/modules/recruitment/screening-override.js";

describe("validateOverrideRequest", () => {
  it("accepts a valid change with a reason", () => {
    expect(validateOverrideRequest({ fromDecision: "ineligible", toDecision: "eligible", reason: "docs re-verified" })).toEqual([]);
  });
  it("requires a reason", () => {
    expect(validateOverrideRequest({ fromDecision: "eligible", toDecision: "shortlisted", reason: "" }).some((e) => e.includes("reason is required"))).toBe(true);
  });
  it("rejects a no-op (same decision)", () => {
    expect(validateOverrideRequest({ fromDecision: "eligible", toDecision: "eligible", reason: "x" }).some((e) => e.includes("must differ"))).toBe(true);
  });
  it("rejects overriding a pending application", () => {
    expect(validateOverrideRequest({ fromDecision: "pending", toDecision: "eligible", reason: "x" }).some((e) => e.includes("pending"))).toBe(true);
  });
  it("rejects an unknown target decision", () => {
    expect(validateOverrideRequest({ fromDecision: "eligible", toDecision: "banished", reason: "x" }).some((e) => e.includes("toDecision must be one of"))).toBe(true);
  });
  it("requires a structured rejection reasonCode when overriding to ineligible", () => {
    expect(validateOverrideRequest({ fromDecision: "eligible", toDecision: "ineligible", reason: "x" }).some((e) => e.includes("rejection reasonCode"))).toBe(true);
    expect(validateOverrideRequest({ fromDecision: "eligible", toDecision: "ineligible", reasonCode: "experience", reason: "x" })).toEqual([]);
  });
});

describe("sodViolationForApprover", () => {
  it("blocks the requester from approving", () => {
    expect(sodViolationForApprover("u1", { requestedBy: "u1" })).toMatch(/requested the override/);
  });
  it("blocks the original screener from approving", () => {
    expect(sodViolationForApprover("u2", { requestedBy: "u1", originalScreenedBy: "u2" })).toMatch(/original screening decision/);
  });
  it("allows an independent approver", () => {
    expect(sodViolationForApprover("u3", { requestedBy: "u1", originalScreenedBy: "u2" })).toBeNull();
  });
  it("allows when there was no original screener recorded", () => {
    expect(sodViolationForApprover("u3", { requestedBy: "u1", originalScreenedBy: null })).toBeNull();
  });
});

describe("isActionable", () => {
  it("is true only for pending", () => {
    expect(isActionable("pending")).toBe(true);
    for (const s of OVERRIDE_STATUSES.filter((x) => x !== "pending")) expect(isActionable(s)).toBe(false);
  });
});
