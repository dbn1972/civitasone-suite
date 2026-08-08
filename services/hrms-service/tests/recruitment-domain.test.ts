/**
 * HRMS Recruitment — requisition, offer, COI domain tests.
 * Packs #04. Source: modules/recruitment/*-domain.ts
 */
import { describe, it, expect } from "vitest";
import { currentStageRole, isFinalStage, canPublish, isEditable, toVacancyType, cloneFields, DEFAULT_GOVT_CHAIN } from "../src/modules/recruitment/requisition-domain.js";
import { computeCompensation, canRelease, isTerminal, isOfferEditable, isDeclineReasonCode, DECLINE_REASON_CODES } from "../src/modules/recruitment/offer-domain.js";
import { detectConflicts } from "../src/modules/recruitment/coi-domain.js";

describe("requisition approval chain", () => {
  it("currentStageRole returns correct role at each stage", () => {
    expect(currentStageRole(DEFAULT_GOVT_CHAIN, 0)).toBe("hiring_manager");
    expect(currentStageRole(DEFAULT_GOVT_CHAIN, 3)).toBe("competent_authority");
  });
  it("isFinalStage: last index is final", () => {
    expect(isFinalStage(DEFAULT_GOVT_CHAIN, 3)).toBe(true);
    expect(isFinalStage(DEFAULT_GOVT_CHAIN, 2)).toBe(false);
  });
  it("out of range → null/false", () => {
    expect(currentStageRole(DEFAULT_GOVT_CHAIN, -1)).toBeNull();
    expect(currentStageRole(DEFAULT_GOVT_CHAIN, 99)).toBeNull();
  });
  it("canPublish only when approved", () => {
    expect(canPublish("approved")).toBe(true);
    expect(canPublish("draft")).toBe(false);
  });
  it("isEditable for draft/returned only", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("returned")).toBe(true);
    expect(isEditable("approved")).toBe(false);
  });
  it("toVacancyType maps recruitment mode correctly", () => {
    expect(toVacancyType("deputation", "")).toBe("deputation");
    expect(toVacancyType("contract", "")).toBe("contractual");
    expect(toVacancyType("direct", "apprenticeship")).toBe("apprenticeship");
    expect(toVacancyType("direct", "regular")).toBe("regular");
  });
  it("cloneFields copies carry fields only", () => {
    const row = { title: "Dev", positionId: "p1", status: "approved", createdAt: "2026-01-01" };
    const cloned = cloneFields(row);
    expect(cloned.title).toBe("Dev");
    expect(cloned.positionId).toBe("p1");
    expect(cloned).not.toHaveProperty("status");
    expect(cloned).not.toHaveProperty("createdAt");
  });
});

describe("offer domain", () => {
  it("computeCompensation sums components to grossCTC (bigint)", () => {
    const c = computeCompensation({ basicMinor: 500_000n, joiningBonusMinor: 50_000n, relocationMinor: 20_000n, variablePayMinor: 100_000n });
    expect(c.grossCtcMinor).toBe(670_000n);
  });
  it("canRelease only when approved", () => {
    expect(canRelease("approved")).toBe(true);
    expect(canRelease("draft")).toBe(false);
  });
  it("isTerminal for accepted/declined/withdrawn/expired/revised", () => {
    expect(isTerminal("accepted")).toBe(true);
    expect(isTerminal("declined")).toBe(true);
    expect(isTerminal("draft")).toBe(false);
  });
  it("isOfferEditable for draft/returned", () => {
    expect(isOfferEditable("draft")).toBe(true);
    expect(isOfferEditable("approved")).toBe(false);
  });
  it("decline reason codes validated", () => {
    expect(isDeclineReasonCode("salary")).toBe(true);
    expect(isDeclineReasonCode("invalid")).toBe(false);
    expect(DECLINE_REASON_CODES.length).toBe(6);
  });
});

describe("COI detection", () => {
  it("detects declared conflict (high severity)", () => {
    const r = detectConflicts({ name: "Alice" }, [{ memberId: "m1", memberName: "Bob", declaredCoi: true }]);
    expect(r.hasConflict).toBe(true);
    expect(r.highestSeverity).toBe("high");
    expect(r.flags[0]!.type).toBe("declared_conflict");
  });
  it("detects identical name (high)", () => {
    const r = detectConflicts({ name: "Ravi Kumar" }, [{ memberId: "m1", memberName: "Kumar Ravi" }]);
    expect(r.flags.some(f => f.type === "identical_name")).toBe(true);
  });
  it("detects shared phone (high)", () => {
    const r = detectConflicts({ name: "X", phone: "+91-9876543210" }, [{ memberId: "m1", memberName: "Y", phone: "9876543210" }]);
    expect(r.flags.some(f => f.type === "shared_phone")).toBe(true);
  });
  it("detects shared institution (low)", () => {
    const r = detectConflicts({ name: "X", institutions: ["IIT Delhi"] }, [{ memberId: "m1", memberName: "Y", institution: "IIT Delhi" }]);
    expect(r.flags.some(f => f.type === "shared_institution")).toBe(true);
    expect(r.flags[0]!.severity).toBe("low");
  });
  it("no conflict when unrelated", () => {
    const r = detectConflicts({ name: "Alice Smith" }, [{ memberId: "m1", memberName: "Bob Jones" }]);
    expect(r.hasConflict).toBe(false);
  });
});
