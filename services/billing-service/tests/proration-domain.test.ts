import { describe, it, expect } from "vitest";
import {
  prorationCredit,
  prorationCharge,
  computeProration,
} from "../src/modules/proration/domain.js";

describe("proration domain — prorationCredit", () => {
  it("computes credit for standard 30-day cycle (upgrade scenario)", () => {
    // Old plan: ₹1000 (100000 paise), 15 days remaining out of 30
    // Credit = (15 * 100000) / 30 = 50000 paise
    const credit = prorationCredit(15, 30, 100000n);
    expect(credit).toBe(50000n);
  });

  it("applies bigint floor division (no rounding up)", () => {
    // 10 days remaining out of 30, plan = 100000 paise
    // Credit = (10 * 100000) / 30 = 1000000 / 30 = 33333 (floor)
    const credit = prorationCredit(10, 30, 100000n);
    expect(credit).toBe(33333n);
  });

  it("returns 0 when daysRemaining is 0", () => {
    const credit = prorationCredit(0, 30, 100000n);
    expect(credit).toBe(0n);
  });

  it("returns full plan amount when daysRemaining equals totalDays", () => {
    // Full period remaining: credit = (30 * 100000) / 30 = 100000
    const credit = prorationCredit(30, 30, 100000n);
    expect(credit).toBe(100000n);
  });

  it("handles 1 day remaining", () => {
    // 1 day remaining out of 30, plan = 100000 paise
    // Credit = (1 * 100000) / 30 = 3333 (floor)
    const credit = prorationCredit(1, 30, 100000n);
    expect(credit).toBe(3333n);
  });

  it("throws if totalDays < 1", () => {
    expect(() => prorationCredit(10, 0, 100000n)).toThrow("totalDays must be at least 1");
  });

  it("throws if daysRemaining < 0", () => {
    expect(() => prorationCredit(-1, 30, 100000n)).toThrow("daysRemaining must be non-negative");
  });

  it("throws if oldPlanPaise < 0", () => {
    expect(() => prorationCredit(10, 30, -1n)).toThrow("oldPlanPaise must be non-negative");
  });
});

describe("proration domain — prorationCharge", () => {
  it("computes charge for standard 30-day cycle (upgrade scenario)", () => {
    // New plan: ₹2000 (200000 paise), 15 days remaining out of 30
    // Charge = (15 * 200000) / 30 = 100000 paise
    const charge = prorationCharge(15, 30, 200000n);
    expect(charge).toBe(100000n);
  });

  it("applies bigint floor division (no rounding up)", () => {
    // 10 days remaining out of 30, plan = 200000 paise
    // Charge = (10 * 200000) / 30 = 2000000 / 30 = 66666 (floor)
    const charge = prorationCharge(10, 30, 200000n);
    expect(charge).toBe(66666n);
  });

  it("returns 0 when daysRemaining is 0", () => {
    const charge = prorationCharge(0, 30, 200000n);
    expect(charge).toBe(0n);
  });

  it("returns full plan amount when daysRemaining equals totalDays", () => {
    const charge = prorationCharge(30, 30, 200000n);
    expect(charge).toBe(200000n);
  });

  it("handles 1 day remaining", () => {
    // 1 day remaining out of 30, plan = 200000 paise
    // Charge = (1 * 200000) / 30 = 6666 (floor)
    const charge = prorationCharge(1, 30, 200000n);
    expect(charge).toBe(6666n);
  });

  it("throws if totalDays < 1", () => {
    expect(() => prorationCharge(10, 0, 200000n)).toThrow("totalDays must be at least 1");
  });

  it("throws if daysRemaining < 0", () => {
    expect(() => prorationCharge(-1, 30, 200000n)).toThrow("daysRemaining must be non-negative");
  });

  it("throws if newPlanPaise < 0", () => {
    expect(() => prorationCharge(10, 30, -1n)).toThrow("newPlanPaise must be non-negative");
  });
});

describe("proration domain — computeProration", () => {
  it("upgrade scenario: new plan > old plan yields positive net", () => {
    // Old: ₹1000/month (100000 paise), New: ₹2000/month (200000 paise)
    // 15 days remaining out of 30
    // Credit = (15 * 100000) / 30 = 50000
    // Charge = (15 * 200000) / 30 = 100000
    // Net = 100000 - 50000 = 50000
    const result = computeProration({
      daysRemaining: 15,
      totalDays: 30,
      oldPlanPaise: 100000n,
      newPlanPaise: 200000n,
    });
    expect(result.credit).toBe(50000n);
    expect(result.charge).toBe(100000n);
    expect(result.netDifference).toBe(50000n);
  });

  it("downgrade scenario: new plan < old plan yields negative net", () => {
    // Old: ₹2000/month (200000 paise), New: ₹1000/month (100000 paise)
    // 15 days remaining out of 30
    // Credit = (15 * 200000) / 30 = 100000
    // Charge = (15 * 100000) / 30 = 50000
    // Net = 50000 - 100000 = -50000
    const result = computeProration({
      daysRemaining: 15,
      totalDays: 30,
      oldPlanPaise: 200000n,
      newPlanPaise: 100000n,
    });
    expect(result.credit).toBe(100000n);
    expect(result.charge).toBe(50000n);
    expect(result.netDifference).toBe(-50000n);
  });

  it("same plan (no-op): net difference is zero", () => {
    const result = computeProration({
      daysRemaining: 15,
      totalDays: 30,
      oldPlanPaise: 100000n,
      newPlanPaise: 100000n,
    });
    expect(result.credit).toBe(50000n);
    expect(result.charge).toBe(50000n);
    expect(result.netDifference).toBe(0n);
  });

  it("1 day remaining: minimal proration with floor division", () => {
    // Old: 100000 paise, New: 200000 paise, 1 day out of 30
    // Credit = (1 * 100000) / 30 = 3333
    // Charge = (1 * 200000) / 30 = 6666
    // Net = 6666 - 3333 = 3333
    const result = computeProration({
      daysRemaining: 1,
      totalDays: 30,
      oldPlanPaise: 100000n,
      newPlanPaise: 200000n,
    });
    expect(result.credit).toBe(3333n);
    expect(result.charge).toBe(6666n);
    expect(result.netDifference).toBe(3333n);
  });

  it("full period remaining: credit and charge equal full plan amounts", () => {
    const result = computeProration({
      daysRemaining: 30,
      totalDays: 30,
      oldPlanPaise: 100000n,
      newPlanPaise: 200000n,
    });
    expect(result.credit).toBe(100000n);
    expect(result.charge).toBe(200000n);
    expect(result.netDifference).toBe(100000n);
  });

  it("bigint precision: large plan amounts do not lose precision", () => {
    // Plan amounts above 2^53 (JavaScript Number limit)
    // Old: 10_000_000_000_000_000 paise (₹100 billion)
    // New: 20_000_000_000_000_000 paise (₹200 billion)
    // 7 days remaining out of 31
    const oldPlan = 10_000_000_000_000_000n;
    const newPlan = 20_000_000_000_000_000n;
    const result = computeProration({
      daysRemaining: 7,
      totalDays: 31,
      oldPlanPaise: oldPlan,
      newPlanPaise: newPlan,
    });

    // Credit = (7 * 10_000_000_000_000_000) / 31
    //        = 70_000_000_000_000_000 / 31
    //        = 2_258_064_516_129_032 (floor)
    const expectedCredit = (7n * oldPlan) / 31n;
    expect(result.credit).toBe(expectedCredit);

    // Charge = (7 * 20_000_000_000_000_000) / 31
    //        = 140_000_000_000_000_000 / 31
    //        = 4_516_129_032_258_064 (floor)
    const expectedCharge = (7n * newPlan) / 31n;
    expect(result.charge).toBe(expectedCharge);

    expect(result.netDifference).toBe(expectedCharge - expectedCredit);
  });

  it("bigint precision: values near Number.MAX_SAFE_INTEGER", () => {
    // 9_007_199_254_740_993 is beyond Number.MAX_SAFE_INTEGER (2^53 - 1)
    const oldPlan = 9_007_199_254_740_993n;
    const newPlan = 9_007_199_254_740_993n * 2n;
    const result = computeProration({
      daysRemaining: 17,
      totalDays: 28,
      oldPlanPaise: oldPlan,
      newPlanPaise: newPlan,
    });

    const expectedCredit = (17n * oldPlan) / 28n;
    const expectedCharge = (17n * newPlan) / 28n;
    expect(result.credit).toBe(expectedCredit);
    expect(result.charge).toBe(expectedCharge);
    expect(result.netDifference).toBe(expectedCharge - expectedCredit);
  });

  it("zero days remaining: both credit and charge are 0", () => {
    const result = computeProration({
      daysRemaining: 0,
      totalDays: 30,
      oldPlanPaise: 100000n,
      newPlanPaise: 200000n,
    });
    expect(result.credit).toBe(0n);
    expect(result.charge).toBe(0n);
    expect(result.netDifference).toBe(0n);
  });

  it("365-day annual cycle with 180 days remaining", () => {
    // Annual plan: ₹12,000 (1_200_000 paise)
    // Credit = (180 * 1_200_000) / 365 = 216_000_000 / 365 = 591_780 (floor)
    const result = computeProration({
      daysRemaining: 180,
      totalDays: 365,
      oldPlanPaise: 1_200_000n,
      newPlanPaise: 2_400_000n,
    });
    expect(result.credit).toBe((180n * 1_200_000n) / 365n);
    expect(result.charge).toBe((180n * 2_400_000n) / 365n);
  });
});

describe("proration domain — separate invoice line items", () => {
  it("credit and charge are independent non-negative line items", () => {
    // Even in downgrade, credit is a positive value (representing a refund line)
    // and charge is a positive value (representing a new charge line)
    const result = computeProration({
      daysRemaining: 20,
      totalDays: 30,
      oldPlanPaise: 300000n,
      newPlanPaise: 100000n,
    });
    expect(result.credit).toBeGreaterThanOrEqual(0n);
    expect(result.charge).toBeGreaterThanOrEqual(0n);
    // Both are separate positive line items
    expect(result.credit).toBe(200000n); // (20 * 300000) / 30 = 200000
    expect(result.charge).toBe(66666n); // (20 * 100000) / 30 = 66666
  });
});
