/**
 * GAP-HR-LEAVE-APPLY-05 -- pure half-day rules (no DB): the validators' shape
 * rules, the tenant-switch / leave-type gate, the overlap exception for the
 * two halves of one date, and which column a reader trusts.
 */
import { describe, it, expect } from "vitest";
import { applyLeaveBody, leaveTenantConfigBody } from "./validators.js";
import {
  assertDayPartAllowed, blockingOverlaps, effectiveBalanceDays, exactAppliedDays,
  isHalfDayMultiple, dayPartUnits, DEFAULT_LEAVE_TENANT_CONFIG, DomainError,
} from "./domain.js";

const U = "3d1c8a52-7f0e-4c58-9a0e-2a3a4f1f9b01";
const base = { employeeId: U, leaveTypeId: U, allocId: U, fromDate: "2026-10-05", toDate: "2026-10-05" };

describe("applyLeaveBody (half-day shape)", () => {
  it("whole-day requests are unchanged: integer days, dayPart defaults to full", () => {
    const ok = applyLeaveBody.parse({ ...base, toDate: "2026-10-07", daysApplied: 3 });
    expect(ok.dayPart).toBe("full");
    expect(applyLeaveBody.safeParse({ ...base, daysApplied: 0.5 }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...base, daysApplied: 0 }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...base, daysApplied: -1 }).success).toBe(false);
  });
  it("a half day / short leave is exactly 0.5 on one date", () => {
    for (const dayPart of ["first_half", "second_half", "short_leave"] as const) {
      expect(applyLeaveBody.safeParse({ ...base, daysApplied: 0.5, dayPart }).success).toBe(true);
    }
    expect(applyLeaveBody.safeParse({ ...base, daysApplied: 1, dayPart: "first_half" }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...base, daysApplied: 1.5, dayPart: "first_half" }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...base, toDate: "2026-10-06", daysApplied: 0.5, dayPart: "first_half" }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...base, daysApplied: 0.5, dayPart: "afternoon" }).success).toBe(false);
  });
  it("the tenant switch body requires both booleans", () => {
    expect(leaveTenantConfigBody.safeParse({ halfDayEnabled: true, shortLeaveEnabled: false }).success).toBe(true);
    expect(leaveTenantConfigBody.safeParse({ halfDayEnabled: true }).success).toBe(false);
  });
});

describe("assertDayPartAllowed", () => {
  const on = { halfDayEnabled: true, shortLeaveEnabled: true };
  it("full day is always allowed, whatever the config or leave type", () => {
    expect(() => assertDayPartAllowed("full", "EL", DEFAULT_LEAVE_TENANT_CONFIG)).not.toThrow();
  });
  it("default config (no row) refuses every part day", () => {
    for (const p of ["first_half", "second_half", "short_leave"] as const) {
      expect(() => assertDayPartAllowed(p, "CL", DEFAULT_LEAVE_TENANT_CONFIG)).toThrowError(/not enabled/);
    }
  });
  it("half-day and short leave are gated independently", () => {
    expect(() => assertDayPartAllowed("first_half", "CL", { halfDayEnabled: true, shortLeaveEnabled: false })).not.toThrow();
    expect(() => assertDayPartAllowed("short_leave", "CL", { halfDayEnabled: true, shortLeaveEnabled: false })).toThrowError(DomainError);
    expect(() => assertDayPartAllowed("short_leave", "CL", { halfDayEnabled: false, shortLeaveEnabled: true })).not.toThrow();
  });
  it("only Casual Leave may be split", () => {
    expect(() => assertDayPartAllowed("first_half", "EL", on)).toThrowError(/Casual Leave/);
    expect(() => assertDayPartAllowed("first_half", "cl", on)).not.toThrow();
  });
});

describe("blockingOverlaps", () => {
  const first = { fromDate: "2026-10-05", toDate: "2026-10-05", dayPart: "first_half" };
  it("the opposite half of the same single date does not block", () => {
    expect(blockingOverlaps([first], { fromDate: "2026-10-05", toDate: "2026-10-05", dayPart: "second_half" })).toEqual([]);
  });
  it("the same half, a full day, a range, or short leave still block", () => {
    const req = { fromDate: "2026-10-05", toDate: "2026-10-05" };
    expect(blockingOverlaps([first], { ...req, dayPart: "first_half" })).toHaveLength(1);
    expect(blockingOverlaps([{ ...req, dayPart: "full" }], { ...req, dayPart: "second_half" })).toHaveLength(1);
    expect(blockingOverlaps([{ fromDate: "2026-10-05", toDate: "2026-10-07", dayPart: "first_half" }], { ...req, dayPart: "second_half" })).toHaveLength(1);
    expect(blockingOverlaps([first], { ...req, dayPart: "short_leave" })).toHaveLength(1);
    expect(blockingOverlaps([first], { ...req, dayPart: "full" })).toHaveLength(1);
  });
});

describe("exact-vs-integer readers", () => {
  it("fall back to the integer column when the numeric one was never written", () => {
    expect(effectiveBalanceDays({ balanceDays: 8, balanceDaysExact: null })).toBe(8);
    expect(exactAppliedDays({ daysApplied: 3, daysAppliedExact: null })).toBe(3);
    expect(exactAppliedDays({ daysApplied: 3 })).toBe(3);
  });
  it("prefer the numeric column (postgres returns numeric as a string)", () => {
    expect(effectiveBalanceDays({ balanceDays: 7, balanceDaysExact: "7.5" })).toBe(7.5);
    expect(exactAppliedDays({ daysApplied: 1, daysAppliedExact: "0.5" })).toBe(0.5);
  });
  it("0.5-multiple helper and unit sizes", () => {
    expect(isHalfDayMultiple(0.5)).toBe(true);
    expect(isHalfDayMultiple(2)).toBe(true);
    expect(isHalfDayMultiple(0.3)).toBe(false);
    expect(isHalfDayMultiple(0)).toBe(false);
    expect(dayPartUnits("full")).toBe(1);
    expect(dayPartUnits("short_leave")).toBe(0.5);
  });
});
