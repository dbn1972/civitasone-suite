/**
 * Offer domain — compensation fitment + lifecycle predicates + decline vocab.
 */
import { describe, it, expect } from "vitest";
import {
  computeCompensation, canRelease, isTerminal, isOfferEditable,
  isDeclineReasonCode, DEFAULT_OFFER_CHAIN, currentStageRole, isFinalStage,
} from "../src/modules/recruitment/offer-domain.js";

describe("computeCompensation", () => {
  it("sums the components into gross CTC (bigint paise)", () => {
    const c = computeCompensation({ basicMinor: 8_00_000_00n, joiningBonusMinor: 1_00_000_00n, relocationMinor: 50_000_00n, variablePayMinor: 2_00_000_00n });
    expect(c.grossCtcMinor).toBe(8_00_000_00n + 1_00_000_00n + 50_000_00n + 2_00_000_00n);
  });
  it("handles all-zero", () => {
    expect(computeCompensation({ basicMinor: 0n, joiningBonusMinor: 0n, relocationMinor: 0n, variablePayMinor: 0n }).grossCtcMinor).toBe(0n);
  });
});

describe("lifecycle predicates", () => {
  it("canRelease only when approved", () => {
    expect(canRelease("approved")).toBe(true);
    for (const s of ["draft", "pending_approval", "released", "accepted"]) expect(canRelease(s)).toBe(false);
  });
  it("isTerminal for completed states", () => {
    for (const s of ["accepted", "declined", "withdrawn", "expired", "revised"]) expect(isTerminal(s)).toBe(true);
    for (const s of ["draft", "pending_approval", "approved", "released"]) expect(isTerminal(s)).toBe(false);
  });
  it("isOfferEditable only draft/returned", () => {
    expect(isOfferEditable("draft")).toBe(true);
    expect(isOfferEditable("returned")).toBe(true);
    expect(isOfferEditable("approved")).toBe(false);
  });
});

describe("decline reasons & chain", () => {
  it("validates decline reason codes", () => {
    expect(isDeclineReasonCode("salary")).toBe(true);
    expect(isDeclineReasonCode("joining_timeline")).toBe(true);
    expect(isDeclineReasonCode("nope")).toBe(false);
  });
  it("default offer chain routes HR->finance->legal->competent authority", () => {
    expect(DEFAULT_OFFER_CHAIN.map((s) => s.role)).toEqual(["hr_admin", "finance_officer", "legal_officer", "competent_authority"]);
    expect(currentStageRole(DEFAULT_OFFER_CHAIN, 0)).toBe("hr_admin");
    expect(isFinalStage(DEFAULT_OFFER_CHAIN, 3)).toBe(true);
    expect(isFinalStage(DEFAULT_OFFER_CHAIN, 2)).toBe(false);
  });
});
