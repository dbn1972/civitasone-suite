/**
 * M2 — Assessment + DCB Ledger domain tests.
 *
 * Covers: DCB invariant (Σdemand − Σcollection = balance), remission maker-checker,
 * revision validation, ageing buckets.
 *
 * _Requirements: SVC-131_
 */
import { describe, it, expect } from "vitest";
import {
  computeDcbSummary,
  assertPaymentNotExceedBalance,
  computeNewBalance,
  assertCanRevise,
  assertMakerChecker,
  ageIntoBuckets,
  DomainError,
} from "../src/modules/assessment/domain.js";

describe("Assessment Domain — M2 SVC-131", () => {
  describe("computeDcbSummary — DCB invariant", () => {
    it("single demand → balance equals demand", () => {
      const entries = [{ entryType: "demand" as const, amountMinor: 500000n }];
      const result = computeDcbSummary(entries);
      expect(result.totalDemand).toBe(500000n);
      expect(result.totalCollection).toBe(0n);
      expect(result.balance).toBe(500000n);
    });

    it("demand + full collection → zero balance", () => {
      const entries = [
        { entryType: "demand" as const, amountMinor: 500000n },
        { entryType: "collection" as const, amountMinor: 500000n },
      ];
      const result = computeDcbSummary(entries);
      expect(result.balance).toBe(0n);
    });

    it("demand + partial collection → remaining balance", () => {
      const entries = [
        { entryType: "demand" as const, amountMinor: 500000n },
        { entryType: "collection" as const, amountMinor: 300000n },
      ];
      const result = computeDcbSummary(entries);
      expect(result.balance).toBe(200000n);
    });

    it("multiple demands + multiple collections", () => {
      const entries = [
        { entryType: "demand" as const, amountMinor: 500000n },
        { entryType: "demand" as const, amountMinor: 300000n },
        { entryType: "collection" as const, amountMinor: 200000n },
        { entryType: "collection" as const, amountMinor: 100000n },
      ];
      const result = computeDcbSummary(entries);
      expect(result.totalDemand).toBe(800000n);
      expect(result.totalCollection).toBe(300000n);
      expect(result.balance).toBe(500000n);
    });

    it("DCB invariant: totalDemand - totalCollection = balance (always)", () => {
      const entries = [
        { entryType: "demand" as const, amountMinor: 1000000n },
        { entryType: "collection" as const, amountMinor: 400000n },
        { entryType: "refund" as const, amountMinor: 50000n },
        { entryType: "adjustment" as const, amountMinor: 100000n },
        { entryType: "write_off" as const, amountMinor: 200000n },
      ];
      const result = computeDcbSummary(entries);
      // total collection = 400000 + 50000 + 100000 + 200000 = 750000
      expect(result.totalDemand - result.totalCollection).toBe(result.balance);
      expect(result.balance).toBe(250000n);
    });
  });

  describe("assertPaymentNotExceedBalance", () => {
    it("allows payment within balance", () => {
      expect(() => assertPaymentNotExceedBalance(300000n, 500000n)).not.toThrow();
    });

    it("allows exact balance payment", () => {
      expect(() => assertPaymentNotExceedBalance(500000n, 500000n)).not.toThrow();
    });

    it("throws on overpayment", () => {
      expect(() => assertPaymentNotExceedBalance(600000n, 500000n)).toThrow(DomainError);
      expect(() => assertPaymentNotExceedBalance(600000n, 500000n)).toThrow("exceeds outstanding balance");
    });
  });

  describe("computeNewBalance", () => {
    it("demand increases balance", () => {
      expect(computeNewBalance(100000n, "demand", 50000n)).toBe(150000n);
    });

    it("collection decreases balance", () => {
      expect(computeNewBalance(100000n, "collection", 30000n)).toBe(70000n);
    });

    it("write_off decreases balance", () => {
      expect(computeNewBalance(100000n, "write_off", 40000n)).toBe(60000n);
    });

    it("adjustment decreases balance", () => {
      expect(computeNewBalance(100000n, "adjustment", 20000n)).toBe(80000n);
    });
  });

  describe("assertCanRevise", () => {
    it("allows revision of active assessment", () => {
      expect(() => assertCanRevise("active")).not.toThrow();
    });

    it("blocks revision of closed assessment", () => {
      expect(() => assertCanRevise("closed")).toThrow(DomainError);
    });

    it("blocks revision of already revised assessment", () => {
      expect(() => assertCanRevise("revised")).toThrow(DomainError);
    });
  });

  describe("assertMakerChecker (remission/refund/write-off)", () => {
    it("different users pass", () => {
      expect(() => assertMakerChecker("maker-1", "checker-1")).not.toThrow();
    });

    it("same user throws MAKER_CHECKER_VIOLATION", () => {
      expect(() => assertMakerChecker("user-x", "user-x")).toThrow("Checker cannot be the same person");
    });
  });

  describe("ageIntoBuckets — arrears ageing", () => {
    const asOf = "2024-07-01";

    it("0-30 day bucket", () => {
      const demands = [{ dueDate: "2024-06-15", balanceMinor: 100000n }]; // 16 days overdue
      const result = ageIntoBuckets(demands, asOf);
      expect(result.bucket0_30).toBe(100000n);
      expect(result.bucket31_60).toBe(0n);
    });

    it("31-60 day bucket", () => {
      const demands = [{ dueDate: "2024-05-20", balanceMinor: 200000n }]; // 42 days overdue
      const result = ageIntoBuckets(demands, asOf);
      expect(result.bucket31_60).toBe(200000n);
    });

    it("61-90 day bucket", () => {
      const demands = [{ dueDate: "2024-04-15", balanceMinor: 300000n }]; // 77 days overdue
      const result = ageIntoBuckets(demands, asOf);
      expect(result.bucket61_90).toBe(300000n);
    });

    it(">90 day bucket", () => {
      const demands = [{ dueDate: "2024-03-01", balanceMinor: 400000n }]; // 122 days overdue
      const result = ageIntoBuckets(demands, asOf);
      expect(result.bucket90Plus).toBe(400000n);
    });

    it("skips zero-balance demands", () => {
      const demands = [{ dueDate: "2024-03-01", balanceMinor: 0n }];
      const result = ageIntoBuckets(demands, asOf);
      expect(result.bucket90Plus).toBe(0n);
    });

    it("multiple demands across buckets", () => {
      const demands = [
        { dueDate: "2024-06-15", balanceMinor: 100000n }, // 0-30
        { dueDate: "2024-05-20", balanceMinor: 200000n }, // 31-60
        { dueDate: "2024-04-15", balanceMinor: 300000n }, // 61-90
        { dueDate: "2024-01-01", balanceMinor: 400000n }, // >90
      ];
      const result = ageIntoBuckets(demands, asOf);
      expect(result.bucket0_30).toBe(100000n);
      expect(result.bucket31_60).toBe(200000n);
      expect(result.bucket61_90).toBe(300000n);
      expect(result.bucket90Plus).toBe(400000n);
    });

    it("not-yet-due demand goes to 0-30", () => {
      const demands = [{ dueDate: "2024-07-15", balanceMinor: 50000n }]; // not yet due
      const result = ageIntoBuckets(demands, asOf);
      expect(result.bucket0_30).toBe(50000n);
    });
  });
});
