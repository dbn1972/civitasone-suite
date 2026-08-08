import { describe, it, expect } from "vitest";
import { smsSegmentCount, seedMatrixForPattern } from "./notificationTypes";

describe("notificationTypes", () => {
  it("counts SMS segments", () => {
    expect(smsSegmentCount("")).toBe(0);
    expect(smsSegmentCount("x".repeat(160))).toBe(1);
    expect(smsSegmentCount("x".repeat(161))).toBe(2);
  });

  it("seeds matrix with defaults for certificate pattern", () => {
    const matrix = seedMatrixForPattern("certificate");
    expect(matrix.submitted?.sms?.enabled).toBe(true);
    expect(matrix.payment_due?.whatsapp?.enabled).toBe(true);
  });
});
