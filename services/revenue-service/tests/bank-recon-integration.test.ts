/**
 * M6 — Bank Reconciliation integration test.
 *
 * Proves that revenue receipts can be matched against bank/treasury settlement
 * files using the finance-service autoMatch domain logic.
 *
 * Covers: matched/unmatched/partial cases, idempotent re-processing.
 *
 * _Requirements: SVC-139_
 */
import { describe, it, expect } from "vitest";
import {
  autoMatch,
  daysBetween,
  normRef,
  type StatementLine,
  type BookEntry,
} from "../../finance-service/src/modules/bank-recon/domain.js";

describe("Bank Reconciliation (M6) — revenue.receipt.captured → BRS", () => {
  // Revenue receipts as book entries (after collection from revenue-service)
  const revenueReceipts: BookEntry[] = [
    { id: "rcpt-001", amountMinor: 500000n, date: "2024-07-01", reference: "UTR-ABC-123" },
    { id: "rcpt-002", amountMinor: 300000n, date: "2024-07-02", reference: "UTR-DEF-456" },
    { id: "rcpt-003", amountMinor: 150000n, date: "2024-07-05", reference: null }, // cash, no UTR
    { id: "rcpt-004", amountMinor: 750000n, date: "2024-07-08", reference: "UTR-GHI-789" },
  ];

  describe("matched cases — reference + amount", () => {
    it("matches receipt to bank line by UTR reference", () => {
      const bankLines: StatementLine[] = [
        { id: "line-1", amountMinor: 500000n, direction: "credit", date: "2024-07-02", reference: "UTR-ABC-123" },
      ];
      const matches = autoMatch(bankLines, revenueReceipts, 3);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.bookId).toBe("rcpt-001");
      expect(matches[0]!.basis).toBe("reference+amount");
    });

    it("matches multiple receipts to multiple bank lines", () => {
      const bankLines: StatementLine[] = [
        { id: "line-1", amountMinor: 500000n, direction: "credit", date: "2024-07-01", reference: "UTR-ABC-123" },
        { id: "line-2", amountMinor: 300000n, direction: "credit", date: "2024-07-03", reference: "UTR-DEF-456" },
      ];
      const matches = autoMatch(bankLines, revenueReceipts, 3);
      expect(matches).toHaveLength(2);
    });
  });

  describe("matched cases — amount + date proximity", () => {
    it("matches by amount + near date when no reference", () => {
      const bankLines: StatementLine[] = [
        { id: "line-cash", amountMinor: 150000n, direction: "credit", date: "2024-07-06", reference: null },
      ];
      const matches = autoMatch(bankLines, revenueReceipts, 3);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.bookId).toBe("rcpt-003");
      expect(matches[0]!.basis).toBe("amount+date");
    });

    it("does not match when date difference exceeds nearDays", () => {
      const bankLines: StatementLine[] = [
        { id: "line-late", amountMinor: 150000n, direction: "credit", date: "2024-07-15", reference: null },
      ];
      const matches = autoMatch(bankLines, revenueReceipts, 3);
      expect(matches).toHaveLength(0); // 10 days gap > 3 nearDays
    });
  });

  describe("unmatched cases", () => {
    it("bank line with no matching receipt stays unmatched", () => {
      const bankLines: StatementLine[] = [
        { id: "line-mystery", amountMinor: 999999n, direction: "credit", date: "2024-07-01", reference: "UNKNOWN-REF" },
      ];
      const matches = autoMatch(bankLines, revenueReceipts, 3);
      expect(matches).toHaveLength(0);
    });

    it("receipt with no matching bank line stays unreconciled", () => {
      // No bank lines at all
      const matches = autoMatch([], revenueReceipts, 3);
      expect(matches).toHaveLength(0);
    });
  });

  describe("partial reconciliation", () => {
    it("partially matches a subset of lines", () => {
      const bankLines: StatementLine[] = [
        { id: "line-1", amountMinor: 500000n, direction: "credit", date: "2024-07-01", reference: "UTR-ABC-123" },
        { id: "line-unmatched", amountMinor: 888888n, direction: "credit", date: "2024-07-01", reference: "NOPE" },
      ];
      const matches = autoMatch(bankLines, revenueReceipts, 3);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.lineId).toBe("line-1");
    });
  });

  describe("idempotent re-processing", () => {
    it("same settlement file produces same matches (deterministic)", () => {
      const bankLines: StatementLine[] = [
        { id: "line-1", amountMinor: 500000n, direction: "credit", date: "2024-07-01", reference: "UTR-ABC-123" },
        { id: "line-2", amountMinor: 300000n, direction: "credit", date: "2024-07-03", reference: "UTR-DEF-456" },
      ];
      const run1 = autoMatch(bankLines, revenueReceipts, 3);
      const run2 = autoMatch(bankLines, revenueReceipts, 3);
      expect(run1).toEqual(run2);
    });

    it("one receipt cannot be matched to two bank lines", () => {
      const bankLines: StatementLine[] = [
        { id: "line-dup-1", amountMinor: 500000n, direction: "credit", date: "2024-07-01", reference: "UTR-ABC-123" },
        { id: "line-dup-2", amountMinor: 500000n, direction: "credit", date: "2024-07-02", reference: "UTR-ABC-123" },
      ];
      const matches = autoMatch(bankLines, revenueReceipts, 3);
      // Only one should match (first wins in greedy algorithm)
      const matchedBookIds = matches.map((m) => m.bookId);
      const uniqueBookIds = [...new Set(matchedBookIds)];
      expect(uniqueBookIds.length).toBe(matchedBookIds.length); // no duplicates
    });
  });

  describe("normRef helper", () => {
    it("normalizes UTR references for comparison", () => {
      expect(normRef("UTR-ABC-123")).toBe("UTRABC123");
      expect(normRef("utr/abc/123")).toBe("UTRABC123");
      expect(normRef(null)).toBe("");
    });
  });

  describe("daysBetween helper", () => {
    it("computes days between dates", () => {
      expect(daysBetween("2024-07-05", "2024-07-01")).toBe(4);
    });
  });
});
