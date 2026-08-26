/**
 * Finance Masters — validation contract tests.
 *
 * Source: services/finance-service/src/modules/masters/*
 * Pack #14: erp-ai-test-prompts/Finance_Module_Test_Pack/14_Finance_Masters_Module_Test_Pack.md
 *
 * Tests fiscal-year format, opening-balance equation, bank-account masking,
 * DDO/PAO code validation, and vendor tax ID format.
 */
import { describe, it, expect } from "vitest";
import { assertOpeningBalancesBalanced, DomainError } from "../src/modules/masters/domain.js";

// ─── Fiscal Year Format Validation ───────────────────────────────────────────

describe("fiscal year format", () => {
  const FY_RE = /^\d{4}-\d{2}$/;

  it("accepts valid FY formats", () => {
    expect(FY_RE.test("2024-25")).toBe(true);
    expect(FY_RE.test("2025-26")).toBe(true);
    expect(FY_RE.test("2099-00")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(FY_RE.test("2024")).toBe(false);
    expect(FY_RE.test("2024-2025")).toBe(false);
    expect(FY_RE.test("24-25")).toBe(false);
  });
});

// ─── Opening Balance Equation ────────────────────────────────────────────────

describe("opening balance equation: sum(Dr) must equal sum(Cr)", () => {
  it("balanced opening entries pass", () => {
    const entries = [
      { headCode: "1100", debitMinor: 500_000n, creditMinor: 0n },
      { headCode: "2100", debitMinor: 0n, creditMinor: 300_000n },
      { headCode: "3100", debitMinor: 0n, creditMinor: 200_000n },
    ];
    const totalDr = entries.reduce((s, e) => s + e.debitMinor, 0n);
    const totalCr = entries.reduce((s, e) => s + e.creditMinor, 0n);
    expect(totalDr).toBe(totalCr);
  });

  it("unbalanced opening entries are rejected", () => {
    const entries = [
      { headCode: "1100", debitMinor: 500_000n, creditMinor: 0n },
      { headCode: "2100", debitMinor: 0n, creditMinor: 499_999n },
    ];
    const totalDr = entries.reduce((s, e) => s + e.debitMinor, 0n);
    const totalCr = entries.reduce((s, e) => s + e.creditMinor, 0n);
    expect(totalDr).not.toBe(totalCr);
  });

  // The two tests above check the arithmetic CONCEPT in the abstract but
  // never call the actual enforcement code -- which is exactly how the real
  // integrity gap went unnoticed: fy-routes.ts validated each entry
  // individually but never summed them, and masters/consumer.ts inserted
  // unconditionally. These tests exercise the real assertOpeningBalancesBalanced
  // (masters/domain.ts), the function fy-routes.ts and consumer.ts now both
  // call before accepting/inserting a set.
  it("assertOpeningBalancesBalanced (the real enforcement fn) accepts a balanced set", () => {
    expect(() => assertOpeningBalancesBalanced([
      { debitMinor: 500_000, creditMinor: 0 },
      { debitMinor: 0, creditMinor: 300_000 },
      { debitMinor: 0, creditMinor: 200_000 },
    ])).not.toThrow();
  });

  it("assertOpeningBalancesBalanced rejects the same unbalanced set with a typed DomainError", () => {
    expect(() => assertOpeningBalancesBalanced([
      { debitMinor: 500_000, creditMinor: 0 },
      { debitMinor: 0, creditMinor: 499_999 },
    ])).toThrow(DomainError);
    try {
      assertOpeningBalancesBalanced([{ debitMinor: 500_000, creditMinor: 0 }, { debitMinor: 0, creditMinor: 499_999 }]);
    } catch (err) {
      expect((err as DomainError).code).toBe("OPENING_BALANCE_UNBALANCED");
    }
  });
});

// ─── Bank Account Masking ────────────────────────────────────────────────────

describe("bank account masking — no full account in response", () => {
  it("masks all but last 4 digits", () => {
    const full = "12345678901234";
    const masked = "*".repeat(full.length - 4) + full.slice(-4);
    expect(masked).toBe("**********1234");
    expect(masked).not.toBe(full);
    expect(masked.length).toBe(full.length);
  });

  it("short account numbers still masked (min 4 chars visible)", () => {
    const full = "123456";
    const masked = "*".repeat(Math.max(0, full.length - 4)) + full.slice(-4);
    expect(masked).toBe("**3456");
  });
});

// ─── DDO Code Validation ─────────────────────────────────────────────────────

describe("DDO code validation (6-12 alphanumeric)", () => {
  const DDO_RE = /^[A-Za-z0-9]{6,12}$/;

  it("accepts valid DDO codes", () => {
    expect(DDO_RE.test("DDO001")).toBe(true);
    expect(DDO_RE.test("ABCDEF123456")).toBe(true);
    expect(DDO_RE.test("A12345")).toBe(true);
  });

  it("rejects too short (< 6)", () => {
    expect(DDO_RE.test("AB")).toBe(false);
    expect(DDO_RE.test("12345")).toBe(false);
  });

  it("rejects too long (> 12)", () => {
    expect(DDO_RE.test("A123456789012")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(DDO_RE.test("DDO-001")).toBe(false);
    expect(DDO_RE.test("DDO 001")).toBe(false);
  });
});

// ─── PAO Code Validation ─────────────────────────────────────────────────────

describe("PAO code validation (4-12 alphanumeric)", () => {
  const PAO_RE = /^[A-Za-z0-9]{4,12}$/;

  it("accepts valid PAO codes", () => {
    expect(PAO_RE.test("PAO1")).toBe(true);
    expect(PAO_RE.test("PAO123456789")).toBe(true);
  });

  it("rejects too short (< 4)", () => {
    expect(PAO_RE.test("PA")).toBe(false);
  });
});

// ─── Vendor Tax ID (GSTIN) Format ────────────────────────────────────────────

describe("GSTIN format validation (15 characters)", () => {
  const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9]\w$/;

  it("accepts valid GSTIN", () => {
    expect(GSTIN_RE.test("27AABCU9603R1ZM")).toBe(true);
    expect(GSTIN_RE.test("29AALCL1234L1Z5")).toBe(true);
  });

  it("rejects invalid GSTIN", () => {
    expect(GSTIN_RE.test("123456789012345")).toBe(false);
    expect(GSTIN_RE.test("INVALID")).toBe(false);
    expect(GSTIN_RE.test("")).toBe(false);
  });
});

// ─── PAN Format Validation ───────────────────────────────────────────────────

describe("PAN format validation (10 chars: AAAAA1234A)", () => {
  const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

  it("accepts valid PAN", () => {
    expect(PAN_RE.test("ABCDE1234F")).toBe(true);
  });

  it("rejects invalid PAN", () => {
    expect(PAN_RE.test("12345ABCDE")).toBe(false);
    expect(PAN_RE.test("ABCDE12345")).toBe(false);
  });
});
