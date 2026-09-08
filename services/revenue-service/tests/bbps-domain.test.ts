/**
 * M7 — BBPS Biller domain tests.
 *
 * Covers: fetch-bill returns live DCB, payment validation, stub path env-gating.
 *
 * _Requirements: SVC-134_
 */
import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildFetchBillResponse,
  validateBbpsPayment,
  isBbpsEnabled,
  verifyBbpsCallback,
  DomainError,
  type DcbOutstanding,
} from "../src/modules/bbps/domain.js";

describe("BBPS Biller Domain — M7 SVC-134", () => {
  describe("buildFetchBillResponse", () => {
    const dcb: DcbOutstanding = {
      assesseeId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ownerName: "Rajan Kumar",
      totalOutstandingMinor: 1500000n, // ₹15,000
      oldestDueDate: "2024-04-01",
      demandCount: 3,
    };

    it("returns formatted response from DCB data", () => {
      const result = buildFetchBillResponse(dcb, "2024-07-01");
      expect(result.customerName).toBe("Rajan Kumar");
      expect(result.billAmountMinor).toBe(1500000n);
      expect(result.billAmount).toBe("15000.00");
      expect(result.dueDate).toBe("2024-04-01");
      expect(result.billNumber).toMatch(/^BBPS-/);
    });

    it("formats rupee amount correctly (with paise)", () => {
      const dcbWithPaise = { ...dcb, totalOutstandingMinor: 1500050n }; // ₹15,000.50
      const result = buildFetchBillResponse(dcbWithPaise, "2024-07-01");
      expect(result.billAmount).toBe("15000.50");
    });

    it("throws when no outstanding balance", () => {
      const zeroDcb = { ...dcb, totalOutstandingMinor: 0n };
      expect(() => buildFetchBillResponse(zeroDcb, "2024-07-01")).toThrow("No outstanding balance");
    });
  });

  describe("validateBbpsPayment", () => {
    it("allows payment within outstanding", () => {
      expect(() => validateBbpsPayment(500000n, 1500000n)).not.toThrow();
    });

    it("allows full payment", () => {
      expect(() => validateBbpsPayment(1500000n, 1500000n)).not.toThrow();
    });

    it("rejects overpayment", () => {
      expect(() => validateBbpsPayment(2000000n, 1500000n)).toThrow("exceeds outstanding");
    });

    it("rejects zero payment", () => {
      expect(() => validateBbpsPayment(0n, 1500000n)).toThrow("must be positive");
    });
  });

  describe("isBbpsEnabled (env-gating)", () => {
    const origEnv = process.env.BBPS_ENABLED;

    afterEach(() => {
      if (origEnv === undefined) {
        delete process.env.BBPS_ENABLED;
      } else {
        process.env.BBPS_ENABLED = origEnv;
      }
    });

    it("returns false when BBPS_ENABLED is not set", () => {
      delete process.env.BBPS_ENABLED;
      expect(isBbpsEnabled()).toBe(false);
    });

    it("returns false when BBPS_ENABLED is not 'true'", () => {
      process.env.BBPS_ENABLED = "false";
      expect(isBbpsEnabled()).toBe(false);
    });

    it("returns true when BBPS_ENABLED is 'true'", () => {
      process.env.BBPS_ENABLED = "true";
      expect(isBbpsEnabled()).toBe(true);
    });
  });

  describe("verifyBbpsCallback (SEC-001)", () => {
    const origSecret = process.env.BBPS_WEBHOOK_SECRET;
    const SECRET = "unit_test_bbps_webhook_secret_x";
    const body = JSON.stringify({ assesseeIdentifier: "PROP-001", amountMinor: "200000", bbpsTxnId: "T1", channel: "bbps" });

    afterEach(() => {
      if (origSecret === undefined) {
        delete process.env.BBPS_WEBHOOK_SECRET;
      } else {
        process.env.BBPS_WEBHOOK_SECRET = origSecret;
      }
    });

    it("accepts a signature correctly computed with the configured secret", () => {
      process.env.BBPS_WEBHOOK_SECRET = SECRET;
      const signature = createHmac("sha256", SECRET).update(body).digest("hex");
      expect(verifyBbpsCallback(body, signature)).toBe(true);
    });

    it("rejects a signature computed with the wrong secret (forged callback)", () => {
      process.env.BBPS_WEBHOOK_SECRET = SECRET;
      const forged = createHmac("sha256", "a-completely-different-secret-32").update(body).digest("hex");
      expect(verifyBbpsCallback(body, forged)).toBe(false);
    });

    it("rejects a signature computed over a different body (tampered payload)", () => {
      process.env.BBPS_WEBHOOK_SECRET = SECRET;
      const signatureForOtherBody = createHmac("sha256", SECRET).update(JSON.stringify({ amountMinor: "1" })).digest("hex");
      expect(verifyBbpsCallback(body, signatureForOtherBody)).toBe(false);
    });

    it("rejects garbage/malformed signature input without throwing", () => {
      process.env.BBPS_WEBHOOK_SECRET = SECRET;
      expect(verifyBbpsCallback(body, "not-hex-at-all")).toBe(false);
      expect(verifyBbpsCallback(body, "")).toBe(false);
    });

    it("throws if BBPS_WEBHOOK_SECRET is not configured", () => {
      delete process.env.BBPS_WEBHOOK_SECRET;
      expect(() => verifyBbpsCallback(body, "anything")).toThrow("BBPS_WEBHOOK_SECRET");
    });
  });
});
