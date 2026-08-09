/**
 * Billing Service — Proration Domain: Deep tests.
 *
 * Tests mid-cycle plan change proration with exact bigint paise arithmetic.
 * Source: modules/proration/domain.ts
 */
import { describe, it, expect } from "vitest";
import { prorationCredit, prorationCharge, computeProration } from "../src/modules/proration/domain.js";

describe("prorationCredit — unused old-plan credit (bigint)", () => {
  it("full month remaining = full credit", () => {
    expect(prorationCredit(30, 30, 99900n)).toBe(99900n);
  });
  it("half month = half credit (floor division)", () => {
    expect(prorationCredit(15, 30, 99900n)).toBe(49950n);
  });
  it("0 days remaining = 0 credit", () => {
    expect(prorationCredit(0, 30, 99900n)).toBe(0n);
  });
  it("throws for totalDays < 1", () => {
    expect(() => prorationCredit(5, 0, 1000n)).toThrow("totalDays must be at least 1");
  });
  it("throws for negative daysRemaining", () => {
    expect(() => prorationCredit(-1, 30, 1000n)).toThrow("daysRemaining must be non-negative");
  });
  it("throws for negative plan price", () => {
    expect(() => prorationCredit(15, 30, -100n)).toThrow("oldPlanPaise must be non-negative");
  });
  it("bigint floor division (no rounding up)", () => {
    // 7 days of 30, plan = 1000 → 7000/30 = 233.33 → floor = 233
    expect(prorationCredit(7, 30, 1000n)).toBe(233n);
  });
});

describe("prorationCharge — new-plan charge (bigint)", () => {
  it("full month = full charge", () => {
    expect(prorationCharge(30, 30, 149900n)).toBe(149900n);
  });
  it("half month = half charge", () => {
    expect(prorationCharge(15, 30, 149900n)).toBe(74950n);
  });
  it("0 days = 0 charge", () => {
    expect(prorationCharge(0, 30, 149900n)).toBe(0n);
  });
  it("throws for invalid inputs", () => {
    expect(() => prorationCharge(5, 0, 1000n)).toThrow();
    expect(() => prorationCharge(-1, 30, 1000n)).toThrow();
    expect(() => prorationCharge(5, 30, -1n)).toThrow();
  });
});

describe("computeProration — full computation", () => {
  it("upgrade: credit < charge → positive netDifference (customer owes)", () => {
    const result = computeProration({ daysRemaining: 15, totalDays: 30, oldPlanPaise: 99900n, newPlanPaise: 149900n });
    expect(result.credit).toBe(49950n);  // 15/30 * 99900
    expect(result.charge).toBe(74950n);  // 15/30 * 149900
    expect(result.netDifference).toBe(25000n); // charge - credit
  });

  it("downgrade: credit > charge → negative netDifference (customer is owed)", () => {
    const result = computeProration({ daysRemaining: 15, totalDays: 30, oldPlanPaise: 149900n, newPlanPaise: 99900n });
    expect(result.netDifference).toBe(-25000n);
  });

  it("same plan: net = 0", () => {
    const result = computeProration({ daysRemaining: 15, totalDays: 30, oldPlanPaise: 99900n, newPlanPaise: 99900n });
    expect(result.netDifference).toBe(0n);
  });

  it("0 days remaining: no credit, no charge, net = 0", () => {
    const result = computeProration({ daysRemaining: 0, totalDays: 30, oldPlanPaise: 99900n, newPlanPaise: 149900n });
    expect(result.credit).toBe(0n);
    expect(result.charge).toBe(0n);
    expect(result.netDifference).toBe(0n);
  });
});
