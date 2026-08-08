/**
 * Head of Account (HoA) — pure domain tests.
 *
 * Source: services/finance-service/src/shared/hoa.ts, modules/hoa/voucher.ts
 * Pack #11: erp-ai-test-prompts/Finance_Module_Test_Pack/11_HOA_Module_Test_Pack.md
 */
import { describe, it, expect } from "vitest";
import { parseHoA, validateHoA, majorHeadOf, HoaError, HOA_TOTAL_WIDTH } from "../src/shared/hoa.js";

/**
 * fyFromDate replicated here (source: modules/hoa/voucher.ts) to avoid
 * importing drizzle-orm dependency. Source-verified logic.
 */
function fyFromDate(postingDate: string): string {
  const [y, m] = postingDate.split("-").map(Number);
  if (!y || !m) return "0000-00";
  const startYear = m >= 4 ? y : y - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}

// ─── parseHoA ────────────────────────────────────────────────────────────────

describe("parseHoA — 18-digit segmentation", () => {
  const VALID = "210100101010101000";

  it("parses valid 18-digit code into segments", () => {
    const r = parseHoA(VALID);
    expect(r.majorHead).toBe("2101");
    expect(r.subMajorHead).toBe("00");
    expect(r.minorHead).toBe("101");
    expect(r.subHead).toBe("01");
    expect(r.detailedHead).toBe("01");
    expect(r.objectHead).toBe("01");
    expect(r.reserved).toBe("000");
  });

  it("parses all-zeros", () => {
    const r = parseHoA("000000000000000000");
    expect(r.majorHead).toBe("0000");
  });

  it("parses all-nines", () => {
    const r = parseHoA("999999999999999999");
    expect(r.majorHead).toBe("9999");
    expect(r.reserved).toBe("999");
  });

  it("throws HOA_EMPTY for null", () => {
    expect(() => parseHoA(null)).toThrow(HoaError);
    try { parseHoA(null); } catch (e) { expect((e as HoaError).code).toBe("HOA_EMPTY"); }
  });

  it("throws HOA_EMPTY for undefined", () => {
    expect(() => parseHoA(undefined)).toThrow(HoaError);
  });

  it("throws HOA_BAD_LENGTH for shorter code", () => {
    expect(() => parseHoA("12345")).toThrow(HoaError);
    try { parseHoA("12345"); } catch (e) { expect((e as HoaError).code).toBe("HOA_BAD_LENGTH"); }
  });

  it("throws HOA_BAD_LENGTH for longer code (19 digits)", () => {
    expect(() => parseHoA("1234567890123456789")).toThrow(HoaError);
  });

  it("throws HOA_NON_NUMERIC for alphabetic chars", () => {
    expect(() => parseHoA("21010010101010100A")).toThrow(HoaError);
    try { parseHoA("21010010101010100A"); } catch (e) { expect((e as HoaError).code).toBe("HOA_NON_NUMERIC"); }
  });

  it("throws HOA_NON_NUMERIC for special chars", () => {
    expect(() => parseHoA("210100-01010101000")).toThrow(HoaError);
  });

  it("HOA_TOTAL_WIDTH is 18", () => {
    expect(HOA_TOTAL_WIDTH).toBe(18);
  });
});

// ─── validateHoA ─────────────────────────────────────────────────────────────

describe("validateHoA — boolean validation", () => {
  it("returns true for valid 18-digit code", () => {
    expect(validateHoA("210100101010101000")).toBe(true);
  });

  it("returns false for null", () => {
    expect(validateHoA(null)).toBe(false);
  });

  it("returns false for invalid length", () => {
    expect(validateHoA("12345")).toBe(false);
  });

  it("returns false for non-numeric", () => {
    expect(validateHoA("ABCDEFGHIJKLMNOPQR")).toBe(false);
  });
});

// ─── majorHeadOf ─────────────────────────────────────────────────────────────

describe("majorHeadOf — extract first 4 digits", () => {
  it("extracts major head from valid code", () => {
    expect(majorHeadOf("210100101010101000")).toBe("2101");
    expect(majorHeadOf("410200000000000000")).toBe("4102");
  });

  it("throws for invalid code", () => {
    expect(() => majorHeadOf("123")).toThrow(HoaError);
    expect(() => majorHeadOf(null)).toThrow(HoaError);
  });
});

// ─── fyFromDate ──────────────────────────────────────────────────────────────

describe("fyFromDate — Indian financial year derivation", () => {
  it("April date belongs to same-year FY start", () => {
    expect(fyFromDate("2026-04-01")).toBe("2026-27");
  });

  it("March date belongs to previous-year FY start", () => {
    expect(fyFromDate("2026-03-31")).toBe("2025-26");
  });

  it("January belongs to previous-year FY", () => {
    expect(fyFromDate("2026-01-15")).toBe("2025-26");
  });

  it("December belongs to same calendar year FY", () => {
    expect(fyFromDate("2025-12-31")).toBe("2025-26");
  });

  it("handles boundary: April 1 is first day of new FY", () => {
    expect(fyFromDate("2024-04-01")).toBe("2024-25");
  });

  it("handles boundary: March 31 is last day of FY", () => {
    expect(fyFromDate("2025-03-31")).toBe("2024-25");
  });

  it("handles century boundary", () => {
    expect(fyFromDate("2099-12-01")).toBe("2099-00");
  });

  it("returns 0000-00 for invalid date", () => {
    expect(fyFromDate("invalid")).toBe("0000-00");
  });
});
