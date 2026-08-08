/**
 * HRMS Leave — balance check and status transition tests.
 * Pack #01. Source: modules/leave/domain.ts
 */
import { describe, it, expect } from "vitest";
import { assertSufficientLeaveBalance, assertLeaveAppStatusTransition, DomainError } from "../src/modules/leave/domain.js";

describe("assertSufficientLeaveBalance", () => {
  it("passes when requested <= balance", () => {
    expect(() => assertSufficientLeaveBalance({ totalDays: 30, balanceDays: 20 }, 10)).not.toThrow();
  });
  it("passes when exactly at balance", () => {
    expect(() => assertSufficientLeaveBalance({ totalDays: 30, balanceDays: 5 }, 5)).not.toThrow();
  });
  it("throws INSUFFICIENT_LEAVE_BALANCE when exceeds", () => {
    expect(() => assertSufficientLeaveBalance({ totalDays: 30, balanceDays: 5 }, 6)).toThrow(DomainError);
    try { assertSufficientLeaveBalance({ totalDays: 30, balanceDays: 0 }, 1); } catch (e) {
      expect((e as DomainError).code).toBe("INSUFFICIENT_LEAVE_BALANCE");
    }
  });
  it("0 days requested always passes", () => {
    expect(() => assertSufficientLeaveBalance({ totalDays: 30, balanceDays: 0 }, 0)).not.toThrow();
  });
});

describe("assertLeaveAppStatusTransition", () => {
  it("draft → pending", () => expect(() => assertLeaveAppStatusTransition("draft", "pending")).not.toThrow());
  it("pending → approved", () => expect(() => assertLeaveAppStatusTransition("pending", "approved")).not.toThrow());
  it("pending → rejected", () => expect(() => assertLeaveAppStatusTransition("pending", "rejected")).not.toThrow());
  it("approved → cancelled", () => expect(() => assertLeaveAppStatusTransition("approved", "cancelled")).not.toThrow());
  it("rejected is terminal", () => expect(() => assertLeaveAppStatusTransition("rejected", "approved")).toThrow(DomainError));
  it("cancelled is terminal", () => expect(() => assertLeaveAppStatusTransition("cancelled", "pending")).toThrow(DomainError));
  it("draft → approved (skip) is illegal", () => expect(() => assertLeaveAppStatusTransition("draft", "approved")).toThrow(DomainError));
  it("error code is INVALID_STATUS_TRANSITION", () => {
    try { assertLeaveAppStatusTransition("rejected", "approved"); } catch (e) { expect((e as DomainError).code).toBe("INVALID_STATUS_TRANSITION"); }
  });
});
