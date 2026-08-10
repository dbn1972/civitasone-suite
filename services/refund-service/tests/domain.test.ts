import { describe, it, expect } from "vitest";
import {
  canTransition,
  validateRefundAmount,
  generateRequestNumber,
} from "../src/modules/requests/domain.js";
import { canComplete, canFail, canReconcile } from "../src/modules/reconciliation/domain.js";
import { getNextApprovalLevel, isFullyApproved } from "../src/modules/processing/domain.js";

describe("refund-service domain", () => {
  it("allows requested → under_review", () => {
    expect(canTransition("requested", "under_review")).toBe(true);
  });
  it("rejects refunded → under_review", () => {
    expect(canTransition("refunded", "under_review")).toBe(false);
  });
  it("accepts valid refund amount", () => {
    expect(validateRefundAmount(50000n, 100000n)).toBe(true);
  });
  it("rejects zero refund amount", () => {
    expect(validateRefundAmount(0n, 100000n)).toBe(false);
  });
  it("rejects refund above original", () => {
    expect(validateRefundAmount(150000n, 100000n)).toBe(false);
  });
  it("generates request number", () => {
    expect(generateRequestNumber("MUM", 11)).toMatch(/^REF\/MUM\/\d{4}\/000011$/);
  });
  it("allows complete from processing", () => {
    expect(canComplete("processing")).toBe(true);
  });
  it("allows fail from processing", () => {
    expect(canFail("processing")).toBe(true);
  });
  it("allows reconcile from completed disbursement", () => {
    expect(canReconcile("completed")).toBe(true);
  });
  it("advances approval level", () => {
    expect(getNextApprovalLevel(1)).toBe(2);
    expect(getNextApprovalLevel(2)).toBe(null);
  });
  it("detects fully approved level", () => {
    expect(isFullyApproved(2)).toBe(true);
  });
});