/**
 * HRMS Pack #01 — Leave Module: Validator boundary tests.
 *
 * Covers LV-02 (invalid leave type), LV-04 (allocation validation),
 * LV-09 (apply boundary cases), LV-17 (reject blank reason),
 * and LV-18 (invalid transition edge cases).
 *
 * Source: modules/leave/validators.ts, modules/leave/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  createLeaveTypeBody,
  allocateLeaveBody,
  applyLeaveBody,
  rejectLeaveBody,
  idParam,
} from "../src/modules/leave/validators.js";
import { assertLeaveAppStatusTransition, DomainError } from "../src/modules/leave/domain.js";

describe("createLeaveTypeBody — LV-02: invalid leave type validation", () => {
  it("accepts valid leave type", () => {
    const result = createLeaveTypeBody.safeParse({
      code: "CL", name: "Casual Leave", maxDays: 8,
      isEncashable: false, carryForward: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty code", () => {
    const result = createLeaveTypeBody.safeParse({
      code: "", name: "Casual Leave", maxDays: 8,
    });
    expect(result.success).toBe(false);
  });

  it("rejects code exceeding 16 chars", () => {
    const result = createLeaveTypeBody.safeParse({
      code: "A".repeat(17), name: "Test", maxDays: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createLeaveTypeBody.safeParse({
      code: "CL", name: "", maxDays: 8,
    });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 128 chars", () => {
    const result = createLeaveTypeBody.safeParse({
      code: "CL", name: "x".repeat(129), maxDays: 8,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative maxDays", () => {
    const result = createLeaveTypeBody.safeParse({
      code: "CL", name: "Test", maxDays: -1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero maxDays (unlimited/not tracked)", () => {
    const result = createLeaveTypeBody.safeParse({
      code: "CO", name: "Comp Off", maxDays: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-integer maxDays", () => {
    const result = createLeaveTypeBody.safeParse({
      code: "CL", name: "Test", maxDays: 5.5,
    });
    expect(result.success).toBe(false);
  });

  it("defaults isEncashable and carryForward to false", () => {
    const result = createLeaveTypeBody.safeParse({ code: "CL", name: "Test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEncashable).toBe(false);
      expect(result.data.carryForward).toBe(false);
      expect(result.data.maxDays).toBe(0);
    }
  });
});

describe("allocateLeaveBody — LV-04: allocation validation", () => {
  const valid = {
    employeeId: "20000000-bbbb-4000-8000-000000000001",
    leaveTypeId: "50000000-eeee-4000-8000-000000000001",
    fy: "2026-27",
    totalDays: 30,
  };

  it("accepts valid allocation", () => {
    expect(allocateLeaveBody.safeParse(valid).success).toBe(true);
  });

  it("rejects non-UUID employeeId", () => {
    expect(allocateLeaveBody.safeParse({ ...valid, employeeId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects non-UUID leaveTypeId", () => {
    expect(allocateLeaveBody.safeParse({ ...valid, leaveTypeId: "xyz" }).success).toBe(false);
  });

  it("rejects malformed FY (wrong format)", () => {
    expect(allocateLeaveBody.safeParse({ ...valid, fy: "2026" }).success).toBe(false);
    expect(allocateLeaveBody.safeParse({ ...valid, fy: "26-27" }).success).toBe(false);
    expect(allocateLeaveBody.safeParse({ ...valid, fy: "2026/27" }).success).toBe(false);
  });

  it("accepts valid FY format YYYY-YY", () => {
    expect(allocateLeaveBody.safeParse({ ...valid, fy: "2025-26" }).success).toBe(true);
  });

  it("rejects zero days", () => {
    expect(allocateLeaveBody.safeParse({ ...valid, totalDays: 0 }).success).toBe(false);
  });

  it("rejects negative days", () => {
    expect(allocateLeaveBody.safeParse({ ...valid, totalDays: -5 }).success).toBe(false);
  });

  it("rejects non-integer days", () => {
    expect(allocateLeaveBody.safeParse({ ...valid, totalDays: 3.5 }).success).toBe(false);
  });
});

describe("applyLeaveBody — LV-09: apply boundary cases", () => {
  const valid = {
    employeeId: "20000000-bbbb-4000-8000-000000000001",
    leaveTypeId: "50000000-eeee-4000-8000-000000000001",
    allocId: "60000000-ffff-4000-8000-000000000001",
    fromDate: "2026-08-01",
    toDate: "2026-08-05",
    daysApplied: 5,
    reason: "Family event",
  };

  it("accepts valid application", () => {
    expect(applyLeaveBody.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid date format (not YYYY-MM-DD)", () => {
    expect(applyLeaveBody.safeParse({ ...valid, fromDate: "01-08-2026" }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...valid, toDate: "2026/08/05" }).success).toBe(false);
  });

  it("rejects non-UUID fields", () => {
    expect(applyLeaveBody.safeParse({ ...valid, employeeId: "bad" }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...valid, leaveTypeId: "bad" }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...valid, allocId: "bad" }).success).toBe(false);
  });

  it("rejects zero or negative daysApplied", () => {
    expect(applyLeaveBody.safeParse({ ...valid, daysApplied: 0 }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...valid, daysApplied: -1 }).success).toBe(false);
  });

  it("rejects non-integer daysApplied", () => {
    expect(applyLeaveBody.safeParse({ ...valid, daysApplied: 2.5 }).success).toBe(false);
  });

  it("enforces reason max length of 1000", () => {
    expect(applyLeaveBody.safeParse({ ...valid, reason: "x".repeat(1001) }).success).toBe(false);
    expect(applyLeaveBody.safeParse({ ...valid, reason: "x".repeat(1000) }).success).toBe(true);
  });

  it("reason is optional", () => {
    const { reason, ...noReason } = valid;
    expect(applyLeaveBody.safeParse(noReason).success).toBe(true);
  });
});

describe("rejectLeaveBody — LV-17: reject reason validation", () => {
  it("accepts non-empty reason", () => {
    expect(rejectLeaveBody.safeParse({ reason: "Insufficient documentation" }).success).toBe(true);
  });

  it("rejects empty reason string", () => {
    expect(rejectLeaveBody.safeParse({ reason: "" }).success).toBe(false);
  });

  it("rejects missing reason field", () => {
    expect(rejectLeaveBody.safeParse({}).success).toBe(false);
  });
});

describe("idParam — UUID enforcement", () => {
  it("accepts valid UUID", () => {
    expect(idParam.safeParse({ id: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true);
  });

  it("rejects non-UUID", () => {
    expect(idParam.safeParse({ id: "not-uuid" }).success).toBe(false);
    expect(idParam.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("assertLeaveAppStatusTransition — LV-18: invalid transitions", () => {
  it("approved → approved is illegal (no double-approve)", () => {
    expect(() => assertLeaveAppStatusTransition("approved", "approved")).toThrow(DomainError);
  });

  it("approved → rejected is illegal", () => {
    expect(() => assertLeaveAppStatusTransition("approved", "rejected")).toThrow(DomainError);
  });

  it("rejected → rejected is illegal", () => {
    expect(() => assertLeaveAppStatusTransition("rejected", "rejected")).toThrow(DomainError);
  });

  it("cancelled → approved is illegal", () => {
    expect(() => assertLeaveAppStatusTransition("cancelled", "approved")).toThrow(DomainError);
  });

  it("cancelled → cancelled is illegal (no double-cancel)", () => {
    expect(() => assertLeaveAppStatusTransition("cancelled", "cancelled")).toThrow(DomainError);
  });

  it("pending → pending is illegal (no re-submit)", () => {
    expect(() => assertLeaveAppStatusTransition("pending", "pending")).toThrow(DomainError);
  });

  it("pending → cancelled is illegal (must be approved first)", () => {
    expect(() => assertLeaveAppStatusTransition("pending", "cancelled")).toThrow(DomainError);
  });
});
