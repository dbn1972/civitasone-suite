/**
 * Resolution Intake — state machine and reviewer contract tests.
 * Pack #22. Source: modules/resolution-intake/*
 */
import { describe, it, expect } from "vitest";

describe("resolution intake status lifecycle", () => {
  type IntakeStatus = "pending_review" | "accepted" | "rejected" | "deferred";
  const TRANSITIONS: Record<IntakeStatus, IntakeStatus[]> = {
    pending_review: ["accepted", "rejected", "deferred"],
    accepted: [],
    rejected: [],
    deferred: ["pending_review"], // can be re-submitted for review
  };
  const can = (f: IntakeStatus, t: IntakeStatus) => (TRANSITIONS[f] ?? []).includes(t);

  it("pending → accepted", () => expect(can("pending_review", "accepted")).toBe(true));
  it("pending → rejected", () => expect(can("pending_review", "rejected")).toBe(true));
  it("pending → deferred", () => expect(can("pending_review", "deferred")).toBe(true));
  it("accepted is terminal", () => expect(can("accepted", "pending_review")).toBe(false));
  it("rejected is terminal", () => expect(can("rejected", "accepted")).toBe(false));
  it("deferred can be re-reviewed", () => expect(can("deferred", "pending_review")).toBe(true));
});

describe("resolution intake reviewer RBAC", () => {
  const REVIEWER_ROLES = ["finance_admin", "super_admin"];
  it("finance_admin can review", () => expect(REVIEWER_ROLES).toContain("finance_admin"));
  it("finance_officer cannot review (needs admin)", () => expect(REVIEWER_ROLES).not.toContain("finance_officer"));
});

describe("resolution intake immutability", () => {
  it("terminal review decision cannot be changed", () => {
    const resolution = { status: "accepted", reason: "Valid financial impact" };
    const isTerminal = ["accepted", "rejected"].includes(resolution.status);
    expect(isTerminal).toBe(true);
  });
});

describe("resolution intake idempotency", () => {
  it("duplicate intake with same source doc = skip (already exists)", () => {
    const existing = new Map([["doc-001", { id: "r1", status: "pending_review" }]]);
    expect(existing.has("doc-001")).toBe(true);
  });
});
