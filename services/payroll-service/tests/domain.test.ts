/**
 * Unit tests for NACH domain logic — settlement date, validation,
 * batch splitting, batch hash, and ASCII sanitization.
 */
import { describe, it, expect } from "vitest";
import {
  computeSettlementDate,
  validateNachBeneficiaries,
  splitIntoBatches,
  computeBatchHash,
  sanitizeAscii,
  type NachBeneficiary,
} from "../src/modules/bank-transfer/domain.js";

// ─── Helper: create a NachBeneficiary with defaults ─────────────────────
function makeBeneficiary(overrides?: Partial<NachBeneficiary>): NachBeneficiary {
  return {
    ifsc: "SBIN0001234",
    accountNo: "12345678901",
    amountMinor: 5000000n, // ₹50,000
    name: "John Doe",
    reference: "EMP001",
    narration: "Salary Jun 2026",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// computeSettlementDate
// ═══════════════════════════════════════════════════════════════════════════
describe("domain — computeSettlementDate", () => {
  it("Friday + 1 offset = Monday (skips Saturday and Sunday)", () => {
    // 2026-07-03 is a Friday
    const friday = new Date(2026, 6, 3); // July 3, 2026
    const result = computeSettlementDate(1, [], friday);
    // Next business day is Monday July 6
    expect(result).toBe("06072026");
  });

  it("Monday + 1 offset = Tuesday", () => {
    // 2026-07-06 is a Monday
    const monday = new Date(2026, 6, 6);
    const result = computeSettlementDate(1, [], monday);
    expect(result).toBe("07072026");
  });

  it("skips holidays", () => {
    // 2026-07-06 is Monday, July 7 is Tuesday (holiday), so +1 = Wednesday July 8
    const monday = new Date(2026, 6, 6);
    const result = computeSettlementDate(1, ["07072026"], monday);
    expect(result).toBe("08072026");
  });

  it("skips multiple consecutive holidays and weekends", () => {
    // 2026-07-02 is Thursday. offset=2.
    // Day 1: Friday July 3 (business day, count=1)
    // Day 2: Saturday July 4 (skip), Sunday July 5 (skip), Monday July 6 (business day, count=2)
    const thursday = new Date(2026, 6, 2);
    const result = computeSettlementDate(2, [], thursday);
    expect(result).toBe("06072026");
  });

  it("offset 0 on a weekday returns the same day", () => {
    // 2026-07-06 is a Monday — already a business day
    const monday = new Date(2026, 6, 6);
    const result = computeSettlementDate(0, [], monday);
    expect(result).toBe("06072026");
  });

  it("offset 0 on a Saturday returns next Monday", () => {
    // 2026-07-04 is a Saturday
    const saturday = new Date(2026, 6, 4);
    const result = computeSettlementDate(0, [], saturday);
    expect(result).toBe("06072026");
  });

  it("offset 0 on a Sunday returns next Monday", () => {
    // 2026-07-05 is a Sunday
    const sunday = new Date(2026, 6, 5);
    const result = computeSettlementDate(0, [], sunday);
    expect(result).toBe("06072026");
  });

  it("offset 0 on a holiday (weekday) returns next business day", () => {
    // 2026-07-06 is Monday (holiday), Tuesday July 7 is next business day
    const monday = new Date(2026, 6, 6);
    const result = computeSettlementDate(0, ["06072026"], monday);
    expect(result).toBe("07072026");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateNachBeneficiaries
// ═══════════════════════════════════════════════════════════════════════════
describe("domain — validateNachBeneficiaries", () => {
  it("valid beneficiary passes", () => {
    const result = validateNachBeneficiaries([makeBeneficiary()]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("catches invalid IFSC (lowercase)", () => {
    const result = validateNachBeneficiaries([
      makeBeneficiary({ ifsc: "sbin0001234", reference: "EMP002" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe("ifsc");
    expect(result.errors[0]!.reference).toBe("EMP002");
  });

  it("catches invalid IFSC (wrong format — missing 0 at position 5)", () => {
    const result = validateNachBeneficiaries([
      makeBeneficiary({ ifsc: "SBIN1001234", reference: "EMP003" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe("ifsc");
  });

  it("catches empty account number", () => {
    const result = validateNachBeneficiaries([
      makeBeneficiary({ accountNo: "", reference: "EMP004" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe("accountNo");
  });

  it("catches whitespace-only account number", () => {
    const result = validateNachBeneficiaries([
      makeBeneficiary({ accountNo: "   ", reference: "EMP005" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe("accountNo");
  });

  it("catches zero amount", () => {
    const result = validateNachBeneficiaries([
      makeBeneficiary({ amountMinor: 0n, reference: "EMP006" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe("amountMinor");
  });

  it("catches negative amount", () => {
    const result = validateNachBeneficiaries([
      makeBeneficiary({ amountMinor: -100n, reference: "EMP007" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe("amountMinor");
  });

  it("reports multiple errors for one beneficiary", () => {
    const result = validateNachBeneficiaries([
      makeBeneficiary({ ifsc: "INVALID", accountNo: "", amountMinor: 0n, reference: "EMP008" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });

  it("reports errors across multiple beneficiaries", () => {
    const result = validateNachBeneficiaries([
      makeBeneficiary({ ifsc: "BAD", reference: "EMP009" }),
      makeBeneficiary({ accountNo: "", reference: "EMP010" }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]!.reference).toBe("EMP009");
    expect(result.errors[1]!.reference).toBe("EMP010");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// splitIntoBatches
// ═══════════════════════════════════════════════════════════════════════════
describe("domain — splitIntoBatches", () => {
  it("respects max record count", () => {
    const beneficiaries = Array.from({ length: 5 }, (_, i) =>
      makeBeneficiary({ reference: `EMP${i}`, amountMinor: 1000n }),
    );
    const batches = splitIntoBatches(beneficiaries, 2, 999_999_999n);
    expect(batches).toHaveLength(3); // [2, 2, 1]
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(2);
    expect(batches[2]).toHaveLength(1);
  });

  it("respects max amount limit", () => {
    const beneficiaries = [
      makeBeneficiary({ amountMinor: 6000n, reference: "A" }),
      makeBeneficiary({ amountMinor: 5000n, reference: "B" }),
      makeBeneficiary({ amountMinor: 4000n, reference: "C" }),
    ];
    // Max 10000n per batch: A(6000) + B(5000) = 11000 > 10000, so B starts new batch
    const batches = splitIntoBatches(beneficiaries, 100, 10000n);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1); // [A]
    expect(batches[1]).toHaveLength(2); // [B, C] (5000+4000=9000 ≤ 10000)
  });

  it("single item per batch when each exceeds amount limit", () => {
    const beneficiaries = [
      makeBeneficiary({ amountMinor: 8000n, reference: "X" }),
      makeBeneficiary({ amountMinor: 9000n, reference: "Y" }),
      makeBeneficiary({ amountMinor: 7000n, reference: "Z" }),
    ];
    // Max 5000n per batch, but each item exceeds — one per batch
    const batches = splitIntoBatches(beneficiaries, 100, 5000n);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(1);
    expect(batches[1]).toHaveLength(1);
    expect(batches[2]).toHaveLength(1);
  });

  it("preserves all beneficiaries (no loss, no duplication)", () => {
    const beneficiaries = Array.from({ length: 7 }, (_, i) =>
      makeBeneficiary({ reference: `EMP${i}`, amountMinor: 3000n }),
    );
    const batches = splitIntoBatches(beneficiaries, 3, 10000n);
    const flattened = batches.flat();
    expect(flattened).toHaveLength(7);
    // Check all references preserved
    const refs = flattened.map((b) => b.reference);
    expect(refs).toEqual(beneficiaries.map((b) => b.reference));
  });

  it("returns empty array for empty input", () => {
    const batches = splitIntoBatches([], 10, 10000n);
    expect(batches).toHaveLength(0);
  });

  it("both limits trigger at the same boundary", () => {
    const beneficiaries = [
      makeBeneficiary({ amountMinor: 5000n, reference: "A" }),
      makeBeneficiary({ amountMinor: 5000n, reference: "B" }),
      makeBeneficiary({ amountMinor: 5000n, reference: "C" }),
    ];
    // maxRecords=2, maxAmount=10000n: [A,B] is 2 records and 10000n exactly (fits), C starts new
    const batches = splitIntoBatches(beneficiaries, 2, 10000n);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeBatchHash
// ═══════════════════════════════════════════════════════════════════════════
describe("domain — computeBatchHash", () => {
  it("is deterministic (same input → same output)", () => {
    const beneficiaries = [
      makeBeneficiary({ accountNo: "12345678901" }),
      makeBeneficiary({ accountNo: "98765432100" }),
    ];
    const hash1 = computeBatchHash(beneficiaries);
    const hash2 = computeBatchHash(beneficiaries);
    expect(hash1).toBe(hash2);
  });

  it("computes correctly for known values", () => {
    // Account "12345678901" → first 8 = "12345678" → 12345678n
    // Account "00000001" → padStart(8,"0") = "00000001" → first 8 = "00000001" → 1n
    const beneficiaries = [
      makeBeneficiary({ accountNo: "12345678901" }),
      makeBeneficiary({ accountNo: "00000001" }),
    ];
    const expected = (12345678n + 1n) % 10_000_000_000_000n;
    expect(computeBatchHash(beneficiaries)).toBe(expected);
  });

  it("handles short account numbers (< 8 chars) by left-padding with zeros", () => {
    // Account "123" → padStart(8,"0") = "00000123" → 123n
    const beneficiaries = [makeBeneficiary({ accountNo: "123" })];
    expect(computeBatchHash(beneficiaries)).toBe(123n);
  });

  it("applies mod 10^13 for large sums", () => {
    // Use account numbers that produce a large first-8-digit sum
    const beneficiaries = Array.from({ length: 200 }, () =>
      makeBeneficiary({ accountNo: "99999999000" }),
    );
    // Each contributes 99999999n. Sum = 200 * 99999999 = 19999999800
    const expectedSum = 200n * 99999999n;
    const expectedHash = expectedSum % 10_000_000_000_000n;
    expect(computeBatchHash(beneficiaries)).toBe(expectedHash);
  });

  it("returns 0 for empty beneficiary list", () => {
    expect(computeBatchHash([])).toBe(0n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sanitizeAscii
// ═══════════════════════════════════════════════════════════════════════════
describe("domain — sanitizeAscii", () => {
  it("strips Unicode characters (non-ASCII)", () => {
    const result = sanitizeAscii("Hello₹World™", 20);
    // "Hello₹World™" → strip non-ASCII → "HelloWorld" (10 chars), pad to 20
    expect(result).toBe("HelloWorld          ");
    expect(result.length).toBe(20);
  });

  it("truncates strings longer than maxLen", () => {
    const result = sanitizeAscii("ABCDEFGHIJ", 5);
    expect(result).toBe("ABCDE");
    expect(result.length).toBe(5);
  });

  it("pads short strings with spaces to exactly maxLen", () => {
    const result = sanitizeAscii("Hi", 10);
    expect(result).toBe("Hi        ");
    expect(result.length).toBe(10);
  });

  it("returns all spaces for empty input", () => {
    const result = sanitizeAscii("", 5);
    expect(result).toBe("     ");
    expect(result.length).toBe(5);
  });

  it("preserves ASCII characters as-is", () => {
    const result = sanitizeAscii("Rajesh Kumar", 40);
    expect(result.startsWith("Rajesh Kumar")).toBe(true);
    expect(result.length).toBe(40);
  });

  it("handles string that is exactly maxLen", () => {
    const result = sanitizeAscii("EXACT", 5);
    expect(result).toBe("EXACT");
    expect(result.length).toBe(5);
  });

  it("strips all chars if entire input is non-ASCII", () => {
    const result = sanitizeAscii("₹™©®", 10);
    expect(result).toBe("          ");
    expect(result.length).toBe(10);
  });

  it("handles mixed ASCII and high-code chars then truncates", () => {
    // "A₹B₹C" → after stripping non-ASCII → "ABC", then pad to 5
    const result = sanitizeAscii("A₹B₹C", 5);
    expect(result).toBe("ABC  ");
  });
});
