/**
 * M4 — Collection domain tests.
 *
 * Covers: receipt validation, refund validation (maker-checker), adjustment validation,
 * over-payment detection, receipt number generation.
 *
 * _Requirements: SVC-133, SVC-135_
 */
import { describe, it, expect } from "vitest";
import {
  validateReceipt,
  validateRefund,
  validateAdjustment,
  generateReceiptNo,
  assertMakerChecker,
  DomainError,
  type ReceiptInput,
  type AdjustmentInput,
} from "../src/modules/collection/domain.js";

describe("Collection Domain — M4 SVC-133/135", () => {
  describe("validateReceipt", () => {
    const baseInput: ReceiptInput = {
      assesseeId: "a-001",
      demandId: "d-001",
      amountMinor: 300000n,
      channel: "online",
      reference: "UTR123",
    };

    it("allows payment within balance", () => {
      expect(() => validateReceipt(baseInput, 500000n)).not.toThrow();
    });

    it("allows exact balance payment", () => {
      const input = { ...baseInput, amountMinor: 500000n };
      expect(() => validateReceipt(input, 500000n)).not.toThrow();
    });

    it("rejects overpayment beyond demand balance", () => {
      const input = { ...baseInput, amountMinor: 600000n };
      expect(() => validateReceipt(input, 500000n)).toThrow(DomainError);
      expect(() => validateReceipt(input, 500000n)).toThrow("exceeds demand balance");
    });

    it("rejects zero amount", () => {
      const input = { ...baseInput, amountMinor: 0n };
      expect(() => validateReceipt(input, 500000n)).toThrow("must be positive");
    });

    it("rejects negative amount", () => {
      const input = { ...baseInput, amountMinor: -100n };
      expect(() => validateReceipt(input, 500000n)).toThrow("must be positive");
    });
  });

  describe("validateRefund", () => {
    it("allows refund within receipt amount", () => {
      expect(() => validateRefund(100000n, 300000n)).not.toThrow();
    });

    it("allows full refund", () => {
      expect(() => validateRefund(300000n, 300000n)).not.toThrow();
    });

    it("rejects refund exceeding receipt", () => {
      expect(() => validateRefund(400000n, 300000n)).toThrow("exceeds receipt");
    });

    it("rejects zero refund", () => {
      expect(() => validateRefund(0n, 300000n)).toThrow("must be positive");
    });
  });

  describe("validateAdjustment", () => {
    const baseAdj: AdjustmentInput = {
      assesseeId: "a-001",
      fromDemandId: "d-001",
      toDemandId: "d-002",
      amountMinor: 50000n,
      reason: "Transfer credit",
    };

    it("allows adjustment within from-demand balance", () => {
      expect(() => validateAdjustment(baseAdj, 100000n)).not.toThrow();
    });

    it("rejects adjustment to same demand", () => {
      const adj = { ...baseAdj, toDemandId: "d-001" };
      expect(() => validateAdjustment(adj, 100000n)).toThrow("same demand");
    });

    it("rejects adjustment exceeding from-demand balance", () => {
      const adj = { ...baseAdj, amountMinor: 200000n };
      expect(() => validateAdjustment(adj, 100000n)).toThrow("exceeds from-demand balance");
    });

    it("rejects zero adjustment", () => {
      const adj = { ...baseAdj, amountMinor: 0n };
      expect(() => validateAdjustment(adj, 100000n)).toThrow("must be positive");
    });
  });

  describe("generateReceiptNo", () => {
    it("formats receipt number correctly", () => {
      expect(generateReceiptNo("2024-2025", 1)).toBe("RCT-2024-2025-00000001");
    });

    it("pads sequence to 8 digits", () => {
      expect(generateReceiptNo("2024-2025", 12345)).toBe("RCT-2024-2025-00012345");
    });
  });

  describe("maker-checker on refunds", () => {
    it("different maker and checker pass", () => {
      expect(() => assertMakerChecker("maker-1", "checker-1")).not.toThrow();
    });

    it("same maker and checker throws", () => {
      expect(() => assertMakerChecker("user-x", "user-x")).toThrow("Checker cannot be the same person");
    });
  });
});
