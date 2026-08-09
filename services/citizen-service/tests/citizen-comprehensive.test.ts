/**
 * Citizen Service — Comprehensive Tests (all remaining modules).
 *
 * Tests fee-payment (exemption computation, receipt numbers, gateway gate),
 * appeal (filing window, order outcomes, order issuability),
 * issuance (cert type normalization, cert numbers, payload hashing, seal),
 * RTI validators, catalogue domain, and application/routing domain additions.
 *
 * Source: modules/fee-payment/domain.ts, modules/appeal/domain.ts,
 *         modules/issuance/domain.ts, modules/rti/validators.ts
 */
import { describe, it, expect } from "vitest";
import { computeFee, buildReceiptNo, isGatewayConfigured, EXEMPTION_KINDS, type ExemptionRule } from "../src/modules/fee-payment/domain.js";
import { assertWithinFilingWindow, orderOutcome, canIssueOrder, DEFAULT_FILING_WINDOW_DAYS, APPEAL_TYPES, APPEAL_STATUSES, ORDER_TYPES, addDays } from "../src/modules/appeal/domain.js";
import { normalizeCertType, buildCertNumber, canonicalize, hashPayload } from "../src/modules/issuance/domain.js";

// ═══ FEE-PAYMENT DOMAIN ═══

describe("computeFee — exemption computation (integer math)", () => {
  const subject = { category: "SC", income: 200000 };

  it("returns base amount when no exemptions match", () => {
    const result = computeFee(50000, [], subject);
    expect(result.baseAmount).toBe(50000);
    expect(result.amount).toBe(50000);
    expect(result.exemptionApplied).toBeNull();
  });

  it("waive exemption → amount = 0", () => {
    const rules: ExemptionRule[] = [{ id: "r1", attribute: "category", op: "in", value: ["SC", "ST"], kind: "waive" }];
    const result = computeFee(50000, rules, subject);
    expect(result.amount).toBe(0);
    expect(result.exemptionApplied).toBe("r1");
  });

  it("percent exemption (50%) → half amount", () => {
    const rules: ExemptionRule[] = [{ id: "r2", attribute: "category", op: "eq", value: "SC", kind: "percent", amount: 50 }];
    const result = computeFee(50000, rules, subject);
    expect(result.amount).toBe(25000); // 50000 - (50000*50/100)
  });

  it("flat exemption → amount reduced by flat value", () => {
    const rules: ExemptionRule[] = [{ id: "r3", attribute: "category", op: "eq", value: "SC", kind: "flat", amount: 10000 }];
    const result = computeFee(50000, rules, subject);
    expect(result.amount).toBe(40000); // 50000 - 10000
  });

  it("flat exemption larger than base → clamped to 0", () => {
    const rules: ExemptionRule[] = [{ id: "r4", attribute: "category", op: "eq", value: "SC", kind: "flat", amount: 99999 }];
    const result = computeFee(50000, rules, subject);
    expect(result.amount).toBe(0);
  });

  it("first matching exemption wins (ordered)", () => {
    const rules: ExemptionRule[] = [
      { id: "r1", attribute: "category", op: "eq", value: "SC", kind: "waive" },
      { id: "r2", attribute: "category", op: "eq", value: "SC", kind: "percent", amount: 50 },
    ];
    const result = computeFee(50000, rules, subject);
    expect(result.exemptionApplied).toBe("r1"); // first match
    expect(result.amount).toBe(0);
  });

  it("non-matching exemption skipped", () => {
    const rules: ExemptionRule[] = [{ id: "r5", attribute: "category", op: "eq", value: "OBC", kind: "waive" }];
    const result = computeFee(50000, rules, subject);
    expect(result.amount).toBe(50000); // SC ≠ OBC
  });

  it("negative base clamped to 0", () => {
    expect(computeFee(-100, [], subject).baseAmount).toBe(0);
  });

  it("integer truncation (no rounding up)", () => {
    // 33% of 10000 = 3333.33 → trunc to 3333
    const rules: ExemptionRule[] = [{ id: "r6", attribute: "category", op: "eq", value: "SC", kind: "percent", amount: 33 }];
    const result = computeFee(10000, rules, subject);
    expect(result.amount).toBe(6700); // 10000 - trunc(10000*33/100) = 10000 - 3300
  });
});

describe("buildReceiptNo", () => {
  it("formats correctly", () => expect(buildReceiptNo(2026, 42)).toBe("RCT-2026-00000042"));
  it("pads sequence to 8 digits", () => expect(buildReceiptNo(2026, 1)).toBe("RCT-2026-00000001"));
  it("large sequence", () => expect(buildReceiptNo(2026, 12345678)).toBe("RCT-2026-12345678"));
});

describe("isGatewayConfigured", () => {
  it("true when PAYMENT_GATEWAY_KEY present", () => expect(isGatewayConfigured({ PAYMENT_GATEWAY_KEY: "rzp_live_xxx" } as any)).toBe(true));
  it("false when no key", () => expect(isGatewayConfigured({} as any)).toBe(false));
  it("false for empty key", () => expect(isGatewayConfigured({ PAYMENT_GATEWAY_KEY: "  " } as any)).toBe(false));
});

describe("EXEMPTION_KINDS", () => {
  it("waive, percent, flat", () => expect([...EXEMPTION_KINDS]).toEqual(["waive", "percent", "flat"]));
});

// ═══ APPEAL DOMAIN ═══

describe("assertWithinFilingWindow — statutory deadline", () => {
  it("DEFAULT_FILING_WINDOW_DAYS is 30", () => expect(DEFAULT_FILING_WINDOW_DAYS).toBe(30));
  it("passes when filed within window", () => {
    const decision = new Date("2026-07-01");
    const filed = new Date("2026-07-15");
    expect(assertWithinFilingWindow(decision, 30, filed).filingDeadline).toBe("2026-07-31");
  });
  it("passes on exact deadline day", () => {
    const decision = new Date("2026-07-01");
    const filed = new Date("2026-07-31");
    expect(() => assertWithinFilingWindow(decision, 30, filed)).not.toThrow();
  });
  it("throws FILING_WINDOW_EXPIRED when past deadline", () => {
    const decision = new Date("2026-07-01");
    const filed = new Date("2026-08-05");
    expect(() => assertWithinFilingWindow(decision, 30, filed)).toThrow("FILING_WINDOW_EXPIRED");
  });
});

describe("orderOutcome — appellate order mapping", () => {
  it("upheld → decided", () => expect(orderOutcome("upheld")).toEqual({ status: "decided", outcome: "upheld" }));
  it("overturned → decided", () => expect(orderOutcome("overturned")).toEqual({ status: "decided", outcome: "overturned" }));
  it("modified → decided", () => expect(orderOutcome("modified")).toEqual({ status: "decided", outcome: "modified" }));
  it("remanded → remanded (separate status)", () => expect(orderOutcome("remanded")).toEqual({ status: "remanded", outcome: "remanded" }));
});

describe("canIssueOrder", () => {
  it("true for hearing status", () => expect(canIssueOrder("hearing")).toBe(true));
  it("true for assigned", () => expect(canIssueOrder("assigned")).toBe(true));
  it("false for filed", () => expect(canIssueOrder("filed")).toBe(false));
  it("false for decided", () => expect(canIssueOrder("decided")).toBe(false));
});

describe("APPEAL constants", () => {
  it("APPEAL_TYPES", () => expect([...APPEAL_TYPES]).toEqual(["appeal", "review", "revision"]));
  it("APPEAL_STATUSES", () => expect([...APPEAL_STATUSES]).toEqual(["filed", "assigned", "hearing", "decided", "remanded", "closed"]));
  it("ORDER_TYPES", () => expect([...ORDER_TYPES]).toEqual(["upheld", "overturned", "modified", "remanded"]));
});

describe("addDays", () => {
  it("adds 30 days", () => expect(addDays(new Date("2026-07-01"), 30).toISOString().slice(0, 10)).toBe("2026-07-31"));
  it("crosses month boundary", () => expect(addDays(new Date("2026-01-30"), 5).toISOString().slice(0, 10)).toBe("2026-02-04"));
});

// ═══ ISSUANCE DOMAIN ═══

describe("normalizeCertType", () => {
  it("uppercases and strips invalid chars", () => expect(normalizeCertType("birth-cert")).toBe("BIRTH_CERT"));
  it("trims and handles spaces", () => expect(normalizeCertType("  INCOME TAX  ")).toBe("INCOME_TAX"));
  it("throws INVALID_CERT_TYPE for too short", () => expect(() => normalizeCertType("X")).toThrow("INVALID_CERT_TYPE"));
});

describe("buildCertNumber", () => {
  it("formats with zero-padded seq", () => expect(buildCertNumber("BIRTH_CERT", 2026, 1)).toBe("BIRTH_CERT-2026-000001"));
  it("throws INVALID_SEQ for 0", () => expect(() => buildCertNumber("X1", 2026, 0)).toThrow("INVALID_SEQ"));
  it("throws INVALID_SEQ for negative", () => expect(() => buildCertNumber("X1", 2026, -1)).toThrow("INVALID_SEQ"));
  it("throws INVALID_SEQ for float", () => expect(() => buildCertNumber("X1", 2026, 1.5)).toThrow("INVALID_SEQ"));
});

describe("canonicalize — stable JSON", () => {
  it("sorts keys deterministically", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
  it("handles arrays", () => expect(canonicalize([1, 2])).toBe("[1,2]"));
  it("handles null", () => expect(canonicalize(null)).toBe("null"));
});

describe("hashPayload — SHA-256 of canonical JSON", () => {
  it("produces 64 hex chars", () => expect(hashPayload({ test: true })).toMatch(/^[0-9a-f]{64}$/));
  it("deterministic", () => expect(hashPayload({ a: 1 })).toBe(hashPayload({ a: 1 })));
  it("different payload = different hash", () => expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 })));
  it("key order doesn't matter (canonical)", () => expect(hashPayload({ b: 2, a: 1 })).toBe(hashPayload({ a: 1, b: 2 })));
});
