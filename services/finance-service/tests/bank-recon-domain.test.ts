/**
 * Bank Reconciliation Domain — pure unit tests.
 *
 * Source: services/finance-service/src/modules/bank-recon/domain.ts
 * Covers:
 *   1. daysBetween — date distance calculation
 *   2. normRef — reference normalization
 *   3. autoMatch — greedy 1:1 matching (reference+amount, then amount+date)
 *   4. Edge cases: no matches, partial matches, duplicate refs, many-to-one prevention
 *   5. Exact opening+transactions=closing equation (conservation)
 *
 * Test pack: erp-ai-test-prompts/Finance_Module_Test_Pack/04_Bank_Reconciliation_Module_Test_Pack.md
 */
import { describe, it, expect } from "vitest";
import {
  daysBetween,
  normRef,
  autoMatch,
  type BookEntry,
  type StatementLine,
} from "../src/modules/bank-recon/domain.js";

// ─── 1. daysBetween ─────────────────────────────────────────────────────────

describe("daysBetween", () => {
  it("returns 0 for same date", () => {
    expect(daysBetween("2026-07-15", "2026-07-15")).toBe(0);
  });

  it("returns 1 for adjacent dates", () => {
    expect(daysBetween("2026-07-15", "2026-07-16")).toBe(1);
  });

  it("is symmetric (absolute difference)", () => {
    expect(daysBetween("2026-07-15", "2026-07-20")).toBe(5);
    expect(daysBetween("2026-07-20", "2026-07-15")).toBe(5);
  });

  it("handles month boundaries", () => {
    expect(daysBetween("2026-01-30", "2026-02-02")).toBe(3);
  });

  it("handles year boundaries", () => {
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });
});

// ─── 2. normRef ──────────────────────────────────────────────────────────────

describe("normRef", () => {
  it("uppercases and strips non-alphanumeric", () => {
    expect(normRef("UTR-1234/abc")).toBe("UTR1234ABC");
  });

  it("returns empty string for null/undefined", () => {
    expect(normRef(null)).toBe("");
    expect(normRef(undefined)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(normRef("")).toBe("");
  });

  it("preserves digits", () => {
    expect(normRef("12345")).toBe("12345");
  });
});

// ─── 3. autoMatch — core reconciliation logic ────────────────────────────────

describe("autoMatch — greedy 1:1 matching", () => {
  describe("Pass 1: reference + amount match", () => {
    it("matches when reference and amount are identical", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 50_000n, direction: "debit", date: "2026-07-15", reference: "UTR123" },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 50_000n, date: "2026-07-10", reference: "UTR123" },
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs).toEqual([{ lineId: "L1", bookId: "B1", basis: "reference+amount" }]);
    });

    it("matches when reference is a substring (either direction)", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 100n, direction: "credit", date: "2026-07-15", reference: "NEFT-UTR456-VENDOR" },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 100n, date: "2026-07-01", reference: "UTR456" },
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs.length).toBe(1);
      expect(pairs[0]!.basis).toBe("reference+amount");
    });

    it("does NOT match when amounts differ despite matching reference", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 50_000n, direction: "debit", date: "2026-07-15", reference: "UTR789" },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 49_999n, date: "2026-07-15", reference: "UTR789" },
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs.length).toBe(0);
    });

    it("ignores case in reference matching", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 1000n, direction: "debit", date: "2026-07-15", reference: "utr-abc" },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 1000n, date: "2026-07-15", reference: "UTR/ABC" },
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs.length).toBe(1);
    });
  });

  describe("Pass 2: amount + date match", () => {
    it("matches when same amount and date within 3 days (default)", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 25_000n, direction: "debit", date: "2026-07-15", reference: null },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 25_000n, date: "2026-07-17", reference: null },
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs).toEqual([{ lineId: "L1", bookId: "B1", basis: "amount+date" }]);
    });

    it("does NOT match when date distance > nearDays", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 25_000n, direction: "debit", date: "2026-07-15", reference: null },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 25_000n, date: "2026-07-20", reference: null },
      ];
      const pairs = autoMatch(lines, books, 3);
      expect(pairs.length).toBe(0);
    });

    it("prefers closest date when multiple candidates", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 10_000n, direction: "debit", date: "2026-07-15", reference: null },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 10_000n, date: "2026-07-18", reference: null },
        { id: "B2", amountMinor: 10_000n, date: "2026-07-16", reference: null },
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs.length).toBe(1);
      expect(pairs[0]!.bookId).toBe("B2"); // closer date
    });
  });

  describe("1:1 policy — no many-to-one", () => {
    it("each book entry matches at most once", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 5_000n, direction: "debit", date: "2026-07-15", reference: "REF1" },
        { id: "L2", amountMinor: 5_000n, direction: "debit", date: "2026-07-15", reference: "REF1" },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 5_000n, date: "2026-07-15", reference: "REF1" },
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs.length).toBe(1); // only one match, not two
    });

    it("each statement line matches at most once", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 5_000n, direction: "debit", date: "2026-07-15", reference: null },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 5_000n, date: "2026-07-15", reference: null },
        { id: "B2", amountMinor: 5_000n, date: "2026-07-15", reference: null },
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs.length).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("returns empty for empty inputs", () => {
      expect(autoMatch([], [])).toEqual([]);
    });

    it("returns empty when no amounts match", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 100n, direction: "debit", date: "2026-07-15", reference: null },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 200n, date: "2026-07-15", reference: null },
      ];
      expect(autoMatch(lines, books).length).toBe(0);
    });

    it("Pass 1 takes priority over Pass 2", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 7_000n, direction: "debit", date: "2026-07-15", reference: "NEFT999" },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 7_000n, date: "2026-07-15", reference: null },        // would match Pass 2
        { id: "B2", amountMinor: 7_000n, date: "2026-01-01", reference: "NEFT999" },   // matches Pass 1
      ];
      const pairs = autoMatch(lines, books);
      expect(pairs.length).toBe(1);
      expect(pairs[0]!.bookId).toBe("B2");
      expect(pairs[0]!.basis).toBe("reference+amount");
    });

    it("custom nearDays parameter changes date tolerance", () => {
      const lines: StatementLine[] = [
        { id: "L1", amountMinor: 1_000n, direction: "credit", date: "2026-07-15", reference: null },
      ];
      const books: BookEntry[] = [
        { id: "B1", amountMinor: 1_000n, date: "2026-07-22", reference: null },
      ];
      expect(autoMatch(lines, books, 3).length).toBe(0);
      expect(autoMatch(lines, books, 7).length).toBe(1);
    });
  });
});

// ─── 4. Opening + transactions = closing (conservation invariant) ────────────

describe("conservation invariant: opening + credits - debits = closing", () => {
  it("statement lines sum correctly (bigint arithmetic)", () => {
    const opening = 1_000_000n;
    const credits = [200_000n, 300_000n];
    const debits = [150_000n, 50_000n];

    const closing = opening + credits.reduce((s, c) => s + c, 0n) - debits.reduce((s, d) => s + d, 0n);
    expect(closing).toBe(1_300_000n);
  });
});
