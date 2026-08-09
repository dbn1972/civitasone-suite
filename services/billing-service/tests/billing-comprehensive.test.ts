/**
 * Billing Service — Comprehensive Domain Tests.
 *
 * Tests invoices (totals, payment, status guards, approval threshold),
 * revenue recognition (daily accruals with remainder invariant),
 * and churn scoring (risk classification, feature extraction, forecast).
 *
 * Source: modules/invoices/domain.ts, modules/revenue/domain.ts, modules/churn/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  shouldSkipInvoiceGeneration, computeTotals, outstandingMinor,
  applyPayment, assertPayable, assertIssuable, assertCancellable,
  assertWithinOutstanding, requiresApproval, APPROVAL_THRESHOLD_MINOR,
  DomainError, type LineItemInput,
} from "../src/modules/invoices/domain.js";
import {
  dailyAccruals, computeDeferredBalance, computeTotalDays, isFullyRecognized,
} from "../src/modules/revenue/domain.js";
import {
  classifyRiskLevel, fallbackChurnScore, computeRevenueForcast,
  type SubscriptionFeatures, type MrrDataPoint,
} from "../src/modules/churn/domain.js";

// ═══════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════

describe("shouldSkipInvoiceGeneration", () => {
  it("true for govt exempt tenants", () => expect(shouldSkipInvoiceGeneration(true)).toBe(true));
  it("false for non-exempt", () => expect(shouldSkipInvoiceGeneration(false)).toBe(false));
});

describe("computeTotals — bigint line item math", () => {
  it("single line item", () => {
    const r = computeTotals([{ description: "License", amountMinor: 99900 }]);
    expect(r.subtotalMinor).toBe(99900n);
    expect(r.taxMinor).toBe(0n);
    expect(r.totalMinor).toBe(99900n);
  });
  it("quantity multiplier", () => {
    const r = computeTotals([{ description: "User seat", amountMinor: 50000, quantity: 10 }]);
    expect(r.subtotalMinor).toBe(500000n);
  });
  it("separates tax and charge lines", () => {
    const items: LineItemInput[] = [
      { description: "License", amountMinor: 100000 },
      { description: "GST 18%", amountMinor: 18000, kind: "tax" },
      { description: "Setup fee", amountMinor: 5000, kind: "charge" },
    ];
    const r = computeTotals(items);
    expect(r.subtotalMinor).toBe(100000n);
    expect(r.taxMinor).toBe(18000n);
    expect(r.chargesMinor).toBe(5000n);
    expect(r.totalMinor).toBe(123000n);
  });
  it("defaults quantity to 1", () => {
    const r = computeTotals([{ description: "X", amountMinor: 1000 }]);
    expect(r.subtotalMinor).toBe(1000n);
  });
  it("empty items = all zeros", () => {
    const r = computeTotals([]);
    expect(r.totalMinor).toBe(0n);
  });
});

describe("outstandingMinor", () => {
  it("total - paid when positive", () => expect(outstandingMinor(100000n, 30000n)).toBe(70000n));
  it("zero when fully paid", () => expect(outstandingMinor(100000n, 100000n)).toBe(0n));
  it("zero when overpaid (clamped)", () => expect(outstandingMinor(100000n, 120000n)).toBe(0n));
});

describe("applyPayment", () => {
  it("partial payment → partially_paid", () => {
    const r = applyPayment(100000n, 0n, 50000n);
    expect(r.paidMinor).toBe(50000n);
    expect(r.status).toBe("partially_paid");
  });
  it("exact full payment → paid", () => {
    const r = applyPayment(100000n, 50000n, 50000n);
    expect(r.paidMinor).toBe(100000n);
    expect(r.status).toBe("paid");
  });
  it("cumulative payments reach total → paid", () => {
    const r = applyPayment(100000n, 99999n, 1n);
    expect(r.status).toBe("paid");
  });
});

describe("assertPayable", () => {
  it("passes for issued", () => expect(() => assertPayable("issued")).not.toThrow());
  it("passes for partially_paid", () => expect(() => assertPayable("partially_paid")).not.toThrow());
  it("throws for draft", () => expect(() => assertPayable("draft")).toThrow(DomainError));
  it("throws for paid", () => expect(() => assertPayable("paid")).toThrow(DomainError));
  it("throws for cancelled", () => expect(() => assertPayable("cancelled")).toThrow(DomainError));
});

describe("assertIssuable", () => {
  it("passes for draft", () => expect(() => assertIssuable("draft")).not.toThrow());
  it("throws for issued", () => expect(() => assertIssuable("issued")).toThrow(DomainError));
  it("throws for paid", () => expect(() => assertIssuable("paid")).toThrow(DomainError));
});

describe("assertCancellable", () => {
  it("passes for draft", () => expect(() => assertCancellable("draft")).not.toThrow());
  it("passes for issued", () => expect(() => assertCancellable("issued")).not.toThrow());
  it("passes for overdue", () => expect(() => assertCancellable("overdue")).not.toThrow());
  it("throws for paid", () => expect(() => assertCancellable("paid")).toThrow(DomainError));
  it("throws for cancelled", () => expect(() => assertCancellable("cancelled")).toThrow(DomainError));
});

describe("assertWithinOutstanding", () => {
  it("passes when amount <= outstanding", () => expect(() => assertWithinOutstanding(100000n, 30000n, 70000n)).not.toThrow());
  it("throws OVERPAYMENT when exceeds", () => expect(() => assertWithinOutstanding(100000n, 90000n, 20000n)).toThrow(DomainError));
  it("throws INVALID_AMOUNT for zero", () => expect(() => assertWithinOutstanding(100000n, 0n, 0n)).toThrow(DomainError));
  it("throws INVALID_AMOUNT for negative", () => expect(() => assertWithinOutstanding(100000n, 0n, -1n)).toThrow(DomainError));
});

describe("requiresApproval — maker-checker threshold", () => {
  it("APPROVAL_THRESHOLD_MINOR is 10000000 (₹1 lakh)", () => expect(APPROVAL_THRESHOLD_MINOR).toBe(10000000n));
  it("true at threshold", () => expect(requiresApproval(10000000n)).toBe(true));
  it("true above threshold", () => expect(requiresApproval(10000001n)).toBe(true));
  it("false below threshold", () => expect(requiresApproval(9999999n)).toBe(false));
});

// ═══════════════════════════════════════════════
// REVENUE RECOGNITION
// ═══════════════════════════════════════════════

describe("dailyAccruals — straight-line with remainder invariant", () => {
  it("sum of accruals === totalPaise (invariant)", () => {
    const accruals = dailyAccruals(99999n, 30);
    const sum = accruals.reduce((s, a) => s + a, 0n);
    expect(sum).toBe(99999n);
  });
  it("30 days = 30 entries", () => expect(dailyAccruals(30000n, 30)).toHaveLength(30));
  it("even division: all days equal", () => {
    const a = dailyAccruals(30000n, 30);
    expect(a.every(v => v === 1000n)).toBe(true);
  });
  it("uneven: last day gets remainder", () => {
    const a = dailyAccruals(10000n, 3); // 10000/3 = 3333 + 1 remainder
    expect(a[0]).toBe(3333n);
    expect(a[1]).toBe(3333n);
    expect(a[2]).toBe(3334n); // 3333 + 1
  });
  it("1 day = entire amount", () => expect(dailyAccruals(50000n, 1)).toEqual([50000n]));
  it("zero amount = all zeros", () => expect(dailyAccruals(0n, 5).every(v => v === 0n)).toBe(true));
  it("throws for totalDays < 1", () => expect(() => dailyAccruals(1000n, 0)).toThrow());
  it("throws for negative totalPaise", () => expect(() => dailyAccruals(-1n, 10)).toThrow());
});

describe("computeDeferredBalance", () => {
  it("deferred = total - recognized", () => expect(computeDeferredBalance(100000n, 30000n)).toBe(70000n));
  it("zero when fully recognized", () => expect(computeDeferredBalance(100000n, 100000n)).toBe(0n));
});

describe("computeTotalDays", () => {
  it("30 days for a month", () => expect(computeTotalDays("2026-07-01", "2026-07-31")).toBe(30));
  it("minimum 1 day", () => expect(computeTotalDays("2026-07-01", "2026-07-01")).toBe(1));
});

describe("isFullyRecognized", () => {
  it("true when recognized >= total", () => expect(isFullyRecognized(100000n, 100000n)).toBe(true));
  it("false when recognized < total", () => expect(isFullyRecognized(50000n, 100000n)).toBe(false));
});

// ═══════════════════════════════════════════════
// CHURN SCORING
// ═══════════════════════════════════════════════

describe("classifyRiskLevel", () => {
  it("high when > 0.70", () => expect(classifyRiskLevel(0.85)).toBe("high"));
  it("medium at 0.40", () => expect(classifyRiskLevel(0.40)).toBe("medium"));
  it("medium at 0.70", () => expect(classifyRiskLevel(0.70)).toBe("medium"));
  it("high at 0.71", () => expect(classifyRiskLevel(0.71)).toBe("high"));
  it("low at 0.39", () => expect(classifyRiskLevel(0.39)).toBe("low"));
  it("low at 0", () => expect(classifyRiskLevel(0)).toBe("low"));
});

describe("fallbackChurnScore — rule-based heuristic", () => {
  it("low risk for healthy engagement", () => {
    const features: SubscriptionFeatures = {
      paymentDelayAvgDays: 0, supportTicketCount90d: 0,
      daysSinceLastLogin: 1, usageScore: 90, tenureDays: 365,
    };
    const result = fallbackChurnScore(features);
    expect(result.riskLevel).toBe("low");
    expect(result.probability).toBeLessThan(0.40);
  });

  it("high risk for disengaged user", () => {
    const features: SubscriptionFeatures = {
      paymentDelayAvgDays: 30, supportTicketCount90d: 10,
      daysSinceLastLogin: 60, usageScore: 10, tenureDays: 30,
    };
    const result = fallbackChurnScore(features);
    expect(result.riskLevel).toBe("high");
    expect(result.probability).toBeGreaterThan(0.70);
  });

  it("returns top 3 factors", () => {
    const features: SubscriptionFeatures = {
      paymentDelayAvgDays: 20, supportTicketCount90d: 5,
      daysSinceLastLogin: 45, usageScore: 30, tenureDays: 60,
    };
    const result = fallbackChurnScore(features);
    expect(result.factors.length).toBeLessThanOrEqual(3);
  });

  it("probability is clamped 0–1", () => {
    const maxFeatures: SubscriptionFeatures = {
      paymentDelayAvgDays: 100, supportTicketCount90d: 100,
      daysSinceLastLogin: 365, usageScore: 0, tenureDays: 1,
    };
    expect(fallbackChurnScore(maxFeatures).probability).toBeLessThanOrEqual(1.0);
    expect(fallbackChurnScore(maxFeatures).probability).toBeGreaterThanOrEqual(0.0);
  });
});
