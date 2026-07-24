/**
 * M3 — Billing domain tests.
 *
 * Covers: bill total equals demand net, receipt head mapping, bill number generation.
 *
 * _Requirements: SVC-132_
 */
import { describe, it, expect } from "vitest";
import {
  generateBillFromDemand,
  assertBillMatchesDemand,
  DomainError,
  type DemandForBill,
} from "../src/modules/billing/domain.js";

const baseDemand: DemandForBill = {
  id: "demand-001",
  assesseeId: "assessee-001",
  assessmentId: "assessment-001",
  rateHeadId: "rh-001",
  financialYear: "2024-2025",
  dueDate: "2024-07-01",
  principalMinor: 500000n,
  rebateMinor: 25000n,
  penaltyMinor: 0n,
  netMinor: 475000n, // 500000 - 25000 + 0
};

describe("Billing Domain — M3 SVC-132", () => {
  describe("generateBillFromDemand", () => {
    it("generates bill with correct total matching demand net", () => {
      const bill = generateBillFromDemand(baseDemand, "property_tax", 1, "2024-06-01");
      expect(bill.totalMinor).toBe(475000n);
      expect(bill.totalMinor).toBe(baseDemand.netMinor);
    });

    it("assigns correct receipt head code for property_tax", () => {
      const bill = generateBillFromDemand(baseDemand, "property_tax", 1, "2024-06-01");
      expect(bill.receiptHeadCode).toBe("0029-PT");
    });

    it("assigns correct receipt head code for water", () => {
      const bill = generateBillFromDemand(baseDemand, "water", 1, "2024-06-01");
      expect(bill.receiptHeadCode).toBe("0215-WC");
    });

    it("assigns correct receipt head code for sewerage", () => {
      const bill = generateBillFromDemand(baseDemand, "sewerage", 1, "2024-06-01");
      expect(bill.receiptHeadCode).toBe("0215-SW");
    });

    it("generates fallback receipt head for unknown category", () => {
      const bill = generateBillFromDemand(baseDemand, "drainage", 1, "2024-06-01");
      expect(bill.receiptHeadCode).toBe("0029-DRAI");
    });

    it("generates bill number with sequence", () => {
      const bill = generateBillFromDemand(baseDemand, "property_tax", 42, "2024-06-01");
      expect(bill.billNo).toBe("BILL-2024-2025-000042");
    });

    it("carries over amounts from demand — no caller-supplied lines", () => {
      const bill = generateBillFromDemand(baseDemand, "property_tax", 1, "2024-06-01");
      expect(bill.principalMinor).toBe(baseDemand.principalMinor);
      expect(bill.rebateMinor).toBe(baseDemand.rebateMinor);
      expect(bill.penaltyMinor).toBe(baseDemand.penaltyMinor);
    });

    it("throws BILL_AMOUNT_MISMATCH when demand net is inconsistent", () => {
      const badDemand = { ...baseDemand, netMinor: 999999n }; // doesn't match P-R+Pen
      expect(() => generateBillFromDemand(badDemand, "property_tax", 1, "2024-06-01"))
        .toThrow(DomainError);
    });

    it("works with penalty included", () => {
      const demandWithPenalty: DemandForBill = {
        ...baseDemand,
        penaltyMinor: 10000n,
        netMinor: 485000n, // 500000 - 25000 + 10000
      };
      const bill = generateBillFromDemand(demandWithPenalty, "property_tax", 1, "2024-06-01");
      expect(bill.totalMinor).toBe(485000n);
    });
  });

  describe("assertBillMatchesDemand", () => {
    it("passes when amounts match", () => {
      expect(() => assertBillMatchesDemand(475000n, 475000n)).not.toThrow();
    });

    it("throws when amounts differ", () => {
      expect(() => assertBillMatchesDemand(475000n, 500000n)).toThrow(DomainError);
    });
  });
});
