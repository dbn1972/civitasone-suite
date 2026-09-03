import { describe, it, expect } from "vitest";
import { canTransition, calculateFeeMinor, generateApplicationNumber, APPLICATION_STATUSES } from "../src/modules/applications/domain.js";
import { validateScrutinyComplete, canDecide } from "../src/modules/approvals/domain.js";
import { canPerformAction, generateLicenceNumber, generateVerificationCode, calculateValidUntil, isExpired } from "../src/modules/licences/domain.js";
import { canRequestRenewal, calculateRenewalFeeMinor, calculateNewValidUntil } from "../src/modules/lifecycle/domain.js";

describe("applications/domain — status transitions (pure)", () => {
  it("draft can move to submitted or withdrawn only", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("draft", "withdrawn")).toBe(true);
    expect(canTransition("draft", "approved")).toBe(false);
  });

  it("terminal statuses (approved/rejected/withdrawn) accept no further transition", () => {
    for (const s of ["approved", "rejected", "withdrawn"] as const) {
      for (const target of APPLICATION_STATUSES) {
        expect(canTransition(s, target)).toBe(false);
      }
    }
  });

  it("under_scrutiny can move to inspecting, approved, or rejected", () => {
    expect(canTransition("under_scrutiny", "inspecting")).toBe(true);
    expect(canTransition("under_scrutiny", "approved")).toBe(true);
    expect(canTransition("under_scrutiny", "rejected")).toBe(true);
    expect(canTransition("under_scrutiny", "withdrawn")).toBe(false);
  });
});

describe("applications/domain — calculateFeeMinor (pure)", () => {
  it("defaults to Rs 1000 for a small services application", () => {
    expect(calculateFeeMinor({ tradeCategory: "services" })).toBe(100000n);
  });

  it("manufacturing/construction carry the higher base fee", () => {
    expect(calculateFeeMinor({ tradeCategory: "manufacturing" })).toBe(500000n);
    expect(calculateFeeMinor({ tradeCategory: "construction" })).toBe(500000n);
  });

  it("wholesale/hospitality carry the mid base fee", () => {
    expect(calculateFeeMinor({ tradeCategory: "wholesale" })).toBe(250000n);
  });

  it("adds a per-employee surcharge above 10 employees", () => {
    const base = calculateFeeMinor({ tradeCategory: "retail" });
    const withStaff = calculateFeeMinor({ tradeCategory: "retail", employeeCount: 15 });
    expect(withStaff).toBe(base + 5n * 2000n);
  });

  it("adds an area surcharge above 500 sqft, in 100-sqft bands", () => {
    const base = calculateFeeMinor({ tradeCategory: "retail" });
    const withArea = calculateFeeMinor({ tradeCategory: "retail", areaInSqft: 750 });
    expect(withArea).toBe(base + 2n * 5000n);
  });
});

describe("applications/domain — generateApplicationNumber (pure)", () => {
  it("embeds the current year and zero-pads the sequence to 6 digits", () => {
    const year = new Date().getUTCFullYear();
    expect(generateApplicationNumber("ULB", 42)).toBe(`TRADE/ULB/${year}/000042`);
  });
});

describe("approvals/domain — validateScrutinyComplete (pure)", () => {
  it("all-pass findings mean no deficiencies", () => {
    const r = validateScrutinyComplete([{ checkItem: "fire_noc", result: "pass" }, { checkItem: "docs", result: "na" }]);
    expect(r.allPassed).toBe(true);
    expect(r.deficiencies).toHaveLength(0);
  });

  it("a single failure is reported, preferring remarks over the check item name", () => {
    const r = validateScrutinyComplete([
      { checkItem: "fire_noc", result: "fail", remarks: "expired NOC" },
      { checkItem: "docs", result: "pass" },
    ]);
    expect(r.allPassed).toBe(false);
    expect(r.deficiencies).toEqual(["expired NOC"]);
  });

  it("falls back to checkItem when a failed finding has no remarks", () => {
    const r = validateScrutinyComplete([{ checkItem: "zoning", result: "fail" }]);
    expect(r.deficiencies).toEqual(["zoning"]);
  });
});

describe("approvals/domain — canDecide (pure)", () => {
  it("only under_scrutiny or inspecting applications can be decided", () => {
    expect(canDecide("under_scrutiny")).toBe(true);
    expect(canDecide("inspecting")).toBe(true);
    expect(canDecide("draft")).toBe(false);
    expect(canDecide("approved")).toBe(false);
  });
});

describe("licences/domain — canPerformAction (pure)", () => {
  it("active can be suspended or cancelled", () => {
    expect(canPerformAction("active", "suspended")).toBe(true);
    expect(canPerformAction("active", "cancelled")).toBe(true);
  });

  it("suspended can be restored (to active) or cancelled", () => {
    expect(canPerformAction("suspended", "active")).toBe(true);
    expect(canPerformAction("suspended", "cancelled")).toBe(true);
  });

  it("cancelled/expired accept no further action", () => {
    expect(canPerformAction("cancelled", "active")).toBe(false);
    expect(canPerformAction("expired", "active")).toBe(false);
  });
});

describe("licences/domain — number/code generation and validity (pure)", () => {
  it("generateLicenceNumber embeds year and zero-pads to 6 digits", () => {
    const year = new Date().getUTCFullYear();
    expect(generateLicenceNumber("ULB", 7)).toBe(`LIC/TRADE/ULB/${year}/000007`);
  });

  it("generateVerificationCode returns a 32-char uppercase hex string, non-deterministic across calls", () => {
    const a = generateVerificationCode();
    const b = generateVerificationCode();
    expect(a).toMatch(/^[0-9A-F]{32}$/);
    expect(a).not.toBe(b);
  });

  it("calculateValidUntil defaults to a 12-month extension", () => {
    const issued = new Date(Date.UTC(2026, 0, 15));
    const until = calculateValidUntil(issued);
    expect(until.getUTCFullYear()).toBe(2027);
    expect(until.getUTCMonth()).toBe(0);
  });

  it("isExpired is false for null (no expiry set) and true once past validUntil", () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 1000 * 60 * 60))).toBe(false);
  });
});

describe("lifecycle/domain — canRequestRenewal (pure)", () => {
  it("surrender is only allowed for an active licence", () => {
    expect(canRequestRenewal("active", "surrender")).toBe(true);
    expect(canRequestRenewal("suspended", "surrender")).toBe(false);
    expect(canRequestRenewal("expired", "surrender")).toBe(false);
  });

  it("renewal/amendment/duplicate are allowed for active or expired licences", () => {
    expect(canRequestRenewal("active", "renewal")).toBe(true);
    expect(canRequestRenewal("expired", "renewal")).toBe(true);
    expect(canRequestRenewal("suspended", "renewal")).toBe(false);
    expect(canRequestRenewal("cancelled", "renewal")).toBe(false);
  });
});

describe("lifecycle/domain — fee and validity calculation (pure)", () => {
  it("calculateRenewalFeeMinor covers every renewal type and a safe default", () => {
    expect(calculateRenewalFeeMinor("renewal")).toBe(75000n);
    expect(calculateRenewalFeeMinor("amendment")).toBe(50000n);
    expect(calculateRenewalFeeMinor("duplicate")).toBe(25000n);
    expect(calculateRenewalFeeMinor("surrender")).toBe(0n);
    expect(calculateRenewalFeeMinor("unknown_type")).toBe(50000n);
  });

  it("calculateNewValidUntil extends from the later of previousValidUntil or now", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    const extended = calculateNewValidUntil(future, 12);
    expect(extended.getUTCFullYear()).toBe(future.getUTCFullYear() + 1);
  });

  it("calculateNewValidUntil starts from now when previousValidUntil is already in the past", () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 400);
    const extended = calculateNewValidUntil(past, 12);
    const nowPlusYear = new Date();
    nowPlusYear.setUTCFullYear(nowPlusYear.getUTCFullYear() + 1);
    // Within a minute of "now + 12 months" (not "past + 12 months", which would still be in the past).
    expect(Math.abs(extended.getTime() - nowPlusYear.getTime())).toBeLessThan(60_000);
  });
});
