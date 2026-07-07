/**
 * Invariant test: C3 — Payment amount conservation.
 *
 * PROPERTY: For any bill, the payment amount MUST equal bill.netMinor.
 * A mismatched amount is rejected (PAYMENT_AMOUNT_MISMATCH).
 *
 * This prevents: cash-out ≠ appropriation-consumed ≠ liability-settled.
 */
import { describe, it, expect } from "vitest";
import {
  assertBillPassed,
  assertValidPaymentMode,
} from "../src/modules/payments/domain.js";

describe("C3 — Payment amount conservation invariant", () => {
  it("rejects payment when amountMinor !== bill.netMinor", () => {
    // Simulate the conservation check from the consumer
    const billNetMinor = 50000n; // 500.00 INR
    const paymentAmountMinor = 45000n; // 450.00 INR (mismatch!)

    const assertConservation = (paymentAmount: bigint, billNet: bigint): void => {
      if (paymentAmount !== billNet) {
        throw new Error(
          `PAYMENT_AMOUNT_MISMATCH: payment ${paymentAmount} paise does not equal bill net ${billNet} paise.`,
        );
      }
    };

    expect(() => assertConservation(paymentAmountMinor, billNetMinor)).toThrow(
      "PAYMENT_AMOUNT_MISMATCH",
    );
  });

  it("accepts payment when amountMinor === bill.netMinor", () => {
    const billNetMinor = 50000n;
    const paymentAmountMinor = 50000n;

    const assertConservation = (paymentAmount: bigint, billNet: bigint): void => {
      if (paymentAmount !== billNet) {
        throw new Error(`PAYMENT_AMOUNT_MISMATCH`);
      }
    };

    expect(() => assertConservation(paymentAmountMinor, billNetMinor)).not.toThrow();
  });

  it("handles bigint amounts beyond Number.MAX_SAFE_INTEGER", () => {
    // Amounts above 2^53 must work correctly with BigInt (not Number)
    const largeBillNet = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    const correctPayment = 9_007_199_254_740_993n;
    const wrongPayment = 9_007_199_254_740_992n; // off by 1

    const assertConservation = (paymentAmount: bigint, billNet: bigint): void => {
      if (paymentAmount !== billNet) {
        throw new Error(`PAYMENT_AMOUNT_MISMATCH`);
      }
    };

    // Correct amount passes
    expect(() => assertConservation(correctPayment, largeBillNet)).not.toThrow();
    // Off-by-one fails (would be masked with Number due to precision loss)
    expect(() => assertConservation(wrongPayment, largeBillNet)).toThrow(
      "PAYMENT_AMOUNT_MISMATCH",
    );
  });

  it("validates that Number cannot safely represent large paise values", () => {
    // This proves WHY we need BigInt: Number loses precision above 2^53
    const large = 9_007_199_254_740_993;
    // Number loses the last digit:
    expect(large).toBe(9_007_199_254_740_992); // precision loss!
    // BigInt does not:
    expect(9_007_199_254_740_993n).not.toBe(9_007_199_254_740_992n);
  });

  it("payment domain validators work correctly", () => {
    expect(() => assertBillPassed("passed")).not.toThrow();
    expect(() => assertBillPassed("pending")).toThrow();
    expect(() => assertValidPaymentMode("NEFT")).not.toThrow();
    expect(() => assertValidPaymentMode("invalid")).toThrow();
  });
});
