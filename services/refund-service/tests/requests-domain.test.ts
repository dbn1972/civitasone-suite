import { describe, it, expect } from "vitest";
import { canTransition, validateRefundAmount, REQUEST_STATUSES } from "../src/modules/requests/domain.js";

describe("canTransition", () => {
  it("allows the normal happy-path sequence", () => {
    expect(canTransition("requested", "under_review")).toBe(true);
    expect(canTransition("under_review", "approved")).toBe(true);
    expect(canTransition("approved", "processing")).toBe(true);
    expect(canTransition("processing", "refunded")).toBe(true);
  });

  it("allows withdraw from either requested or under_review", () => {
    expect(canTransition("requested", "withdrawn")).toBe(true);
    expect(canTransition("under_review", "withdrawn")).toBe(true);
  });

  it("allows the processing return-for-correction path back to requested", () => {
    // processing/consumer.ts's returnRequest moves under_review -> requested;
    // this table has to reflect that or it's lying about what the system
    // actually does.
    expect(canTransition("under_review", "requested")).toBe(true);
  });

  it("allows a failed disbursement to be retried", () => {
    expect(canTransition("failed", "processing")).toBe(true);
  });

  it("treats rejected, refunded, and withdrawn as terminal", () => {
    for (const to of REQUEST_STATUSES) {
      expect(canTransition("rejected", to)).toBe(false);
      expect(canTransition("refunded", to)).toBe(false);
      expect(canTransition("withdrawn", to)).toBe(false);
    }
  });

  it("rejects skipping straight from requested to approved", () => {
    expect(canTransition("requested", "approved")).toBe(false);
  });

  it("rejects withdrawing an already-approved or already-processing request", () => {
    expect(canTransition("approved", "withdrawn")).toBe(false);
    expect(canTransition("processing", "withdrawn")).toBe(false);
  });
});

describe("validateRefundAmount", () => {
  it("accepts a refund equal to the original amount", () => {
    expect(validateRefundAmount(10000n, 10000n)).toBe(true);
  });

  it("accepts a partial refund", () => {
    expect(validateRefundAmount(1n, 10000n)).toBe(true);
  });

  it("rejects a refund exceeding the original amount", () => {
    // The exact live-confirmed exploit: requesting 999999 minor units of
    // refund against a 10000 minor-unit original transaction.
    expect(validateRefundAmount(999999n, 10000n)).toBe(false);
  });

  it("rejects a zero or negative refund amount", () => {
    expect(validateRefundAmount(0n, 10000n)).toBe(false);
    expect(validateRefundAmount(-1n, 10000n)).toBe(false);
  });
});
