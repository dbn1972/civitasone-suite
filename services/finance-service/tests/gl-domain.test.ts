/**
 * gl/domain.ts — unit tests for journal balance validation.
 *
 * Covers:
 *   1. Balanced journal (sum Dr = sum Cr) — passes
 *   2. Unbalanced journal — throws JOURNAL_UNBALANCED
 *   3. Too few lines (< 2) — throws JOURNAL_TOO_FEW_LINES
 *   4. Edge cases: zero amounts, large bigint, negative coercion, many lines
 *   5. Property: double-entry always conserves money
 *
 * Source: services/finance-service/src/modules/gl/domain.ts
 */
import { describe, it, expect } from "vitest";
import { assertJournalBalances, DomainError } from "../src/modules/gl/domain.js";
import type { JournalLine } from "../src/modules/gl/schema.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function line(accountCode: string, debitMinor: number | bigint, creditMinor: number | bigint): JournalLine {
  return { accountCode, debitMinor, creditMinor };
}

// ─── 1. Balanced Journal ─────────────────────────────────────────────────────

describe("assertJournalBalances — balanced journals pass", () => {
  it("simple 2-line balanced journal", () => {
    expect(() => assertJournalBalances([
      line("1100", 50000, 0),
      line("2100", 0, 50000),
    ])).not.toThrow();
  });

  it("multi-line balanced journal (4 lines)", () => {
    expect(() => assertJournalBalances([
      line("5100", 30000, 0),
      line("5200", 20000, 0),
      line("2050", 0, 25000),
      line("2051", 0, 25000),
    ])).not.toThrow();
  });

  it("balanced with large amounts above 2^53", () => {
    const amount = 10_000_000_000_000_000n; // 1e16 paise = Rs 1 lakh crore
    expect(() => assertJournalBalances([
      line("1200", amount, 0n),
      line("2100", 0n, amount),
    ])).not.toThrow();
  });

  it("balanced with mixed number and string amounts (coerced to bigint)", () => {
    // JournalLine type allows string/number/bigint for debitMinor/creditMinor
    expect(() => assertJournalBalances([
      line("1100", "999999", "0"),
      line("2100", "0", "999999"),
    ])).not.toThrow();
  });
});

// ─── 2. Unbalanced Journal ───────────────────────────────────────────────────

describe("assertJournalBalances — unbalanced journals rejected", () => {
  it("throws when debit > credit", () => {
    expect(() => assertJournalBalances([
      line("1100", 60000, 0),
      line("2100", 0, 50000),
    ])).toThrow(DomainError);
    try {
      assertJournalBalances([
        line("1100", 60000, 0),
        line("2100", 0, 50000),
      ]);
    } catch (e) {
      expect((e as DomainError).code).toBe("JOURNAL_UNBALANCED");
      expect((e as DomainError).message).toContain("debit");
      expect((e as DomainError).message).toContain("credit");
    }
  });

  it("throws when credit > debit", () => {
    expect(() => assertJournalBalances([
      line("1100", 40000, 0),
      line("2100", 0, 50000),
    ])).toThrow(DomainError);
  });

  it("throws for off-by-one paise imbalance", () => {
    expect(() => assertJournalBalances([
      line("1100", 100001, 0),
      line("2100", 0, 100000),
    ])).toThrow(DomainError);
  });

  it("throws for large unbalanced amount (above 2^53)", () => {
    const big = 10_000_000_000_000_001n;
    const small = 10_000_000_000_000_000n;
    expect(() => assertJournalBalances([
      line("1200", big, 0n),
      line("2100", 0n, small),
    ])).toThrow(DomainError);
  });
});

// ─── 3. Too Few Lines ────────────────────────────────────────────────────────

describe("assertJournalBalances — minimum 2 lines required", () => {
  it("throws for 0 lines", () => {
    expect(() => assertJournalBalances([])).toThrow(DomainError);
    try { assertJournalBalances([]); } catch (e) {
      expect((e as DomainError).code).toBe("JOURNAL_TOO_FEW_LINES");
    }
  });

  it("throws for 1 line", () => {
    expect(() => assertJournalBalances([
      line("1100", 50000, 50000),
    ])).toThrow(DomainError);
  });

  it("throws for null/undefined input", () => {
    expect(() => assertJournalBalances(null as any)).toThrow();
    expect(() => assertJournalBalances(undefined as any)).toThrow();
  });
});

// ─── 4. Edge Cases ───────────────────────────────────────────────────────────

describe("assertJournalBalances — edge cases", () => {
  it("accepts a journal where every line has both debit and credit (net still balances)", () => {
    // This is unusual but valid: line with both Dr and Cr (cross-entry)
    expect(() => assertJournalBalances([
      line("1100", 100, 30),
      line("2100", 30, 100),
    ])).not.toThrow();
  });

  it("accepts exactly 2 lines", () => {
    expect(() => assertJournalBalances([
      line("A", 1, 0),
      line("B", 0, 1),
    ])).not.toThrow();
  });

  it("works with many lines (100+)", () => {
    const lines: JournalLine[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(line(`D${i}`, 100, 0));
    }
    // Total debit = 10,000. Add one credit line to balance.
    lines.push(line("C", 0, 10000));
    expect(() => assertJournalBalances(lines)).not.toThrow();
  });

  it("zero-zero journal (all amounts are 0) passes balance check but has no movement", () => {
    // The domain function only checks balance (Dr==Cr), not that movement > 0.
    // The consumer rejects zero-movement journals separately (INT-FIX in gl/consumer.ts).
    expect(() => assertJournalBalances([
      line("1100", 0, 0),
      line("2100", 0, 0),
    ])).not.toThrow();
  });
});

// ─── 5. Double-Entry Conservation Property ───────────────────────────────────

describe("property: double-entry always conserves money", () => {
  it("any balanced journal summed across all accounts nets to zero", () => {
    const journals: JournalLine[][] = [
      // Asset acquisition
      [line("1200", 500000, 0), line("2100", 0, 500000)],
      // Depreciation
      [line("5100", 50000, 0), line("1250", 0, 50000)],
      // Revenue
      [line("1100", 200000, 0), line("4100", 0, 200000)],
      // Expense
      [line("5200", 75000, 0), line("1100", 0, 75000)],
    ];

    let totalDebit = 0n;
    let totalCredit = 0n;

    for (const journal of journals) {
      // Each journal must balance individually
      assertJournalBalances(journal);
      for (const l of journal) {
        totalDebit += BigInt(l.debitMinor);
        totalCredit += BigInt(l.creditMinor);
      }
    }

    // The SYSTEM as a whole must balance (trial balance invariant)
    expect(totalDebit).toBe(totalCredit);
  });
});
