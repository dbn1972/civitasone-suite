/**
 * Grant Service — Domain Logic: Deep tests.
 *
 * Tests application lifecycle, scheme eligibility, disbursement guards,
 * utilisation certificate validation, and exact-money bigint arithmetic.
 *
 * Source: modules/application/domain.ts, modules/scheme/domain.ts,
 *         modules/disbursement/domain.ts, modules/utilisation/domain.ts
 */
import { describe, it, expect } from "vitest";
import { APPLICATION_STATUSES, assertTransition, type ApplicationStatus } from "../src/modules/application/domain.js";
import { checkEligibility, type BeneficiaryProfile } from "../src/modules/scheme/domain.js";
import { assertDisbursementWithinApproved, MAX_DISBURSEMENT_RETRIES, canRetryDisbursement } from "../src/modules/disbursement/domain.js";
import { assertUcExpenditureWithinDisbursed } from "../src/modules/utilisation/domain.js";

// ═══ Application Lifecycle ═══

describe("APPLICATION_STATUSES", () => {
  it("declares 6 statuses", () => expect(APPLICATION_STATUSES).toHaveLength(6));
  it("in order: draft→submitted→under_review→approved→rejected→withdrawn", () => {
    expect([...APPLICATION_STATUSES]).toEqual(["draft", "submitted", "under_review", "approved", "rejected", "withdrawn"]);
  });
});

describe("assertTransition — grant application state machine", () => {
  const valid: [string, ApplicationStatus][] = [
    ["draft", "submitted"], ["draft", "withdrawn"],
    ["submitted", "under_review"], ["submitted", "withdrawn"],
    ["under_review", "approved"], ["under_review", "rejected"],
  ];
  for (const [from, to] of valid) {
    it(`${from} → ${to}`, () => expect(() => assertTransition(from, to)).not.toThrow());
  }

  const invalid: [string, ApplicationStatus][] = [
    ["draft", "approved"], ["draft", "rejected"],
    ["submitted", "approved"], ["submitted", "rejected"],
    ["under_review", "submitted"], ["under_review", "withdrawn"],
    ["approved", "rejected"], ["approved", "submitted"],
    ["rejected", "approved"], ["rejected", "submitted"],
    ["withdrawn", "submitted"], ["withdrawn", "approved"],
  ];
  for (const [from, to] of invalid) {
    it(`${from} → ${to} is illegal`, () => expect(() => assertTransition(from, to)).toThrow("INVALID_TRANSITION"));
  }

  it("terminal statuses have no outward transitions", () => {
    for (const s of ["approved", "rejected", "withdrawn"] as ApplicationStatus[]) {
      for (const target of APPLICATION_STATUSES) {
        expect(() => assertTransition(s, target)).toThrow();
      }
    }
  });
});

// ═══ Scheme Eligibility ═══

describe("checkEligibility — scheme criteria evaluation", () => {
  it("eligible when no criteria defined", () => {
    expect(checkEligibility([], { age: 25 }).eligible).toBe(true);
  });

  it("eligible when age within range", () => {
    const criteria = [{ criterionKey: "age", minValue: "18", maxValue: "60", allowedValues: null } as any];
    expect(checkEligibility(criteria, { age: 30 }).eligible).toBe(true);
  });

  it("ineligible when age below minimum", () => {
    const criteria = [{ criterionKey: "age", minValue: "18", maxValue: "60", allowedValues: null } as any];
    const result = checkEligibility(criteria, { age: 16 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("below minimum");
  });

  it("ineligible when age exceeds maximum", () => {
    const criteria = [{ criterionKey: "age", minValue: "18", maxValue: "60", allowedValues: null } as any];
    const result = checkEligibility(criteria, { age: 65 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("exceeds maximum");
  });

  it("ineligible when age not provided", () => {
    const criteria = [{ criterionKey: "age", minValue: "18", maxValue: null, allowedValues: null } as any];
    expect(checkEligibility(criteria, {}).eligible).toBe(false);
  });

  it("ineligible when income exceeds limit", () => {
    const criteria = [{ criterionKey: "income", minValue: null, maxValue: "500000000", allowedValues: null } as any]; // ₹50L
    const result = checkEligibility(criteria, { incomeAnnualMinor: 600000000n });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("exceeds limit");
  });

  it("eligible when income within limit", () => {
    const criteria = [{ criterionKey: "income", minValue: null, maxValue: "500000000", allowedValues: null } as any];
    expect(checkEligibility(criteria, { incomeAnnualMinor: 300000000n }).eligible).toBe(true);
  });

  it("ineligible when category not in allowed list", () => {
    const criteria = [{ criterionKey: "category", minValue: null, maxValue: null, allowedValues: ["SC", "ST", "OBC"] } as any];
    const result = checkEligibility(criteria, { category: "General" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("not in allowed list");
  });

  it("eligible when category in allowed list", () => {
    const criteria = [{ criterionKey: "category", minValue: null, maxValue: null, allowedValues: ["SC", "ST"] } as any];
    expect(checkEligibility(criteria, { category: "SC" }).eligible).toBe(true);
  });

  it("ineligible when geography not in allowed list", () => {
    const criteria = [{ criterionKey: "geography", minValue: null, maxValue: null, allowedValues: ["rural", "semi_urban"] } as any];
    expect(checkEligibility(criteria, { geography: "urban" }).eligible).toBe(false);
  });

  it("eligible when geography matches", () => {
    const criteria = [{ criterionKey: "geography", minValue: null, maxValue: null, allowedValues: ["rural"] } as any];
    expect(checkEligibility(criteria, { geography: "rural" }).eligible).toBe(true);
  });
});

// ═══ Disbursement Guards ═══

describe("assertDisbursementWithinApproved — grant disbursement cap", () => {
  it("passes when within budget", () => {
    expect(() => assertDisbursementWithinApproved(1000000n, 200000n, 300000n)).not.toThrow();
  });

  it("passes at exact boundary (disbursed + new = approved)", () => {
    expect(() => assertDisbursementWithinApproved(1000000n, 700000n, 300000n)).not.toThrow();
  });

  it("throws when exceeds approved amount", () => {
    expect(() => assertDisbursementWithinApproved(1000000n, 700000n, 400000n)).toThrow("DISBURSEMENT_EXCEEDS_APPROVED");
  });

  it("throws when first disbursement exceeds approved", () => {
    expect(() => assertDisbursementWithinApproved(500000n, 0n, 600000n)).toThrow("DISBURSEMENT_EXCEEDS_APPROVED");
  });

  it("passes when zero new amount", () => {
    expect(() => assertDisbursementWithinApproved(1000000n, 500000n, 0n)).not.toThrow();
  });
});

describe("canRetryDisbursement — retry policy", () => {
  it("MAX_DISBURSEMENT_RETRIES is 3", () => expect(MAX_DISBURSEMENT_RETRIES).toBe(3));
  it("can retry at count 0, 1, 2", () => {
    expect(canRetryDisbursement(0)).toBe(true);
    expect(canRetryDisbursement(1)).toBe(true);
    expect(canRetryDisbursement(2)).toBe(true);
  });
  it("cannot retry at count 3 (exhausted)", () => {
    expect(canRetryDisbursement(3)).toBe(false);
  });
  it("cannot retry beyond max", () => {
    expect(canRetryDisbursement(10)).toBe(false);
  });
});

// ═══ Utilisation Certificate ═══

describe("assertUcExpenditureWithinDisbursed — UC validation", () => {
  it("passes when utilised <= disbursed", () => {
    expect(() => assertUcExpenditureWithinDisbursed(1000000n, 800000n)).not.toThrow();
  });

  it("passes at exact boundary", () => {
    expect(() => assertUcExpenditureWithinDisbursed(1000000n, 1000000n)).not.toThrow();
  });

  it("throws when utilised exceeds disbursed", () => {
    expect(() => assertUcExpenditureWithinDisbursed(500000n, 600000n)).toThrow("UC_EXPENDITURE_EXCEEDS_DISBURSED");
  });

  it("passes when zero utilised", () => {
    expect(() => assertUcExpenditureWithinDisbursed(1000000n, 0n)).not.toThrow();
  });
});
