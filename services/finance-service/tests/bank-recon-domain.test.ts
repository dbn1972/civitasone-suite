/**
 * Coverage tests for bank-recon/domain.ts (0% → target: 100%).
 * Pure matching logic — no DB or I/O.
 */
import { describe, it, expect } from "vitest";
import { autoMatch, daysBetween, normRef, type BookEntry, type StatementLine } from "../src/modules/bank-recon/domain.js";

describe("bank-recon/domain — daysBetween()", () => {
  it("returns 0 for same date", () => {
    expect(daysBetween("2025-06-01", "2025-06-01")).toBe(0);
  });

  it("returns positive absolute difference", () => {
    expect(daysBetween("2025-06-01", "2025-06-11")).toBe(10);
    expect(daysBetween("2025-06-11", "2025-06-01")).toBe(10);
  });
});

describe("bank-recon/domain — normRef()", () => {
  it("uppercases and strips non-alphanumeric", () => {
    expect(normRef("UTR-123-ABC")).toBe("UTR123ABC");
    expect(normRef("neft/ref/456")).toBe("NEFTREF456");
  });

  it("returns empty for null/undefined", () => {
    expect(normRef(null)).toBe("");
    expect(normRef(undefined)).toBe("");
  });
});

describe("bank-recon/domain — autoMatch()", () => {
  const books: BookEntry[] = [
    { id: "b1", amountMinor: 1000000n, date: "2025-06-01", reference: "UTR123" },
    { id: "b2", amountMinor: 2000000n, date: "2025-06-03", reference: "CHQ456" },
    { id: "b3", amountMinor: 1000000n, date: "2025-06-05", reference: null },
    { id: "b4", amountMinor: 5000000n, date: "2025-06-10", reference: "NEFT789" },
  ];

  it("matches by reference+amount (pass 1)", () => {
    const lines: StatementLine[] = [
      { id: "s1", amountMinor: 1000000n, direction: "debit", date: "2025-06-02", reference: "UTR123" },
    ];
    const pairs = autoMatch(lines, books);
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.lineId).toBe("s1");
    expect(pairs[0]!.bookId).toBe("b1");
    expect(pairs[0]!.basis).toBe("reference+amount");
  });

  it("matches by amount+date (pass 2) when no reference", () => {
    const lines: StatementLine[] = [
      { id: "s2", amountMinor: 1000000n, direction: "debit", date: "2025-06-05", reference: null },
    ];
    const pairs = autoMatch(lines, books);
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.bookId).toBe("b3"); // matches b3 (same amount, same date)
    expect(pairs[0]!.basis).toBe("amount+date");
  });

  it("does not double-match a book entry", () => {
    const lines: StatementLine[] = [
      { id: "s1", amountMinor: 1000000n, direction: "debit", date: "2025-06-01", reference: "UTR123" },
      { id: "s2", amountMinor: 1000000n, direction: "debit", date: "2025-06-02", reference: "UTR123" }, // same ref
    ];
    const pairs = autoMatch(lines, books);
    // Only one can match b1
    expect(pairs.filter((p) => p.bookId === "b1").length).toBe(1);
  });

  it("returns empty when no matches", () => {
    const lines: StatementLine[] = [
      { id: "s1", amountMinor: 9999999n, direction: "debit", date: "2025-06-01", reference: "NONE" },
    ];
    expect(autoMatch(lines, books)).toEqual([]);
  });

  it("respects nearDays parameter", () => {
    const lines: StatementLine[] = [
      { id: "s1", amountMinor: 5000000n, direction: "debit", date: "2025-06-15", reference: null },
    ];
    // Default nearDays=3, b4 is at 2025-06-10 (5 days away) — should NOT match
    expect(autoMatch(lines, books, 3)).toEqual([]);
    // With nearDays=5, should match
    const pairs = autoMatch(lines, books, 5);
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.bookId).toBe("b4");
  });

  it("handles empty inputs gracefully", () => {
    expect(autoMatch([], books)).toEqual([]);
    expect(autoMatch([{ id: "s", amountMinor: 100n, direction: "debit", date: "2025-01-01", reference: null }], [])).toEqual([]);
  });

  it("reference matching is case-insensitive and ignores separators", () => {
    const lines: StatementLine[] = [
      { id: "s1", amountMinor: 2000000n, direction: "debit", date: "2025-06-10", reference: "chq-456" },
    ];
    const pairs = autoMatch(lines, books);
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.bookId).toBe("b2");
    expect(pairs[0]!.basis).toBe("reference+amount");
  });
});
