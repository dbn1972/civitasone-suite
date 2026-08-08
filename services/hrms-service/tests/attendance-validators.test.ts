/**
 * HRMS Pack #02 — Attendance Module: Validator boundary tests.
 *
 * Covers AT-03 (batch min/max), AT-04 (record field validation),
 * AT-14 (lock/unlock validation), AT-17 (regularisation validation).
 *
 * Source: modules/attendance/validators.ts
 */
import { describe, it, expect } from "vitest";
import {
  markAttendanceBody,
  attendanceQueryParams,
  regularisationCreateBody,
  periodLockBody,
} from "../src/modules/attendance/validators.js";

const VALID_EMP = "41000000-dddd-4000-8000-000000000001";
const VALID_SHIFT = "51000000-eeee-4000-8000-000000000001";

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: VALID_EMP,
    attendanceDate: "2026-07-15",
    status: "present",
    inTime: "09:00",
    outTime: "17:30",
    lateMins: 0,
    ...overrides,
  };
}

describe("markAttendanceBody — AT-03: batch size boundaries", () => {
  it("accepts 1 record (minimum)", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord()] });
    expect(result.success).toBe(true);
  });

  it("accepts 200 records (maximum)", () => {
    const records = Array.from({ length: 200 }, () => validRecord());
    const result = markAttendanceBody.safeParse({ records });
    expect(result.success).toBe(true);
  });

  it("rejects 0 records (empty array)", () => {
    const result = markAttendanceBody.safeParse({ records: [] });
    expect(result.success).toBe(false);
  });

  it("rejects 201 records (over maximum)", () => {
    const records = Array.from({ length: 201 }, () => validRecord());
    const result = markAttendanceBody.safeParse({ records });
    expect(result.success).toBe(false);
  });
});

describe("markAttendanceBody — AT-04: record field validation matrix", () => {
  it("accepts valid complete record", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord()] });
    expect(result.success).toBe(true);
  });

  it("rejects invalid employee UUID", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ employeeId: "bad" })] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ attendanceDate: "15-07-2026" })] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status value", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ status: "late" })] });
    expect(result.success).toBe(false);
  });

  it("accepts all valid status values", () => {
    for (const status of ["present", "absent", "half_day", "on_leave", "holiday"]) {
      const result = markAttendanceBody.safeParse({ records: [validRecord({ status })] });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid shift UUID", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ shiftId: "not-uuid" })] });
    expect(result.success).toBe(false);
  });

  it("accepts valid shift UUID", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ shiftId: VALID_SHIFT })] });
    expect(result.success).toBe(true);
  });

  it("rejects invalid time format", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ inTime: "9:00" })] });
    expect(result.success).toBe(false);
    const result2 = markAttendanceBody.safeParse({ records: [validRecord({ outTime: "5PM" })] });
    expect(result2.success).toBe(false);
  });

  it("accepts valid HH:MM time format", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ inTime: "08:30", outTime: "18:00" })] });
    expect(result.success).toBe(true);
  });

  it("rejects negative lateMins", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ lateMins: -1 })] });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer lateMins", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ lateMins: 5.5 })] });
    expect(result.success).toBe(false);
  });

  it("accepts zero lateMins", () => {
    const result = markAttendanceBody.safeParse({ records: [validRecord({ lateMins: 0 })] });
    expect(result.success).toBe(true);
  });

  it("defaults status to present", () => {
    const { status, ...noStatus } = validRecord();
    const result = markAttendanceBody.safeParse({ records: [noStatus] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.records[0]?.status).toBe("present");
  });

  it("defaults lateMins to 0", () => {
    const { lateMins, ...noLate } = validRecord();
    const result = markAttendanceBody.safeParse({ records: [noLate] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.records[0]?.lateMins).toBe(0);
  });
});

describe("periodLockBody — AT-14: lock/unlock validation", () => {
  it("accepts valid YYYY-MM period", () => {
    const result = periodLockBody.safeParse({ period: "2026-07" });
    expect(result.success).toBe(true);
  });

  it("rejects malformed period (YYYY only)", () => {
    const result = periodLockBody.safeParse({ period: "2026" });
    expect(result.success).toBe(false);
  });

  it("rejects malformed period (YYYY-MM-DD)", () => {
    const result = periodLockBody.safeParse({ period: "2026-07-01" });
    expect(result.success).toBe(false);
  });

  it("rejects malformed period (slash format)", () => {
    const result = periodLockBody.safeParse({ period: "07/2026" });
    expect(result.success).toBe(false);
  });

  it("reason is optional", () => {
    const result = periodLockBody.safeParse({ period: "2026-07" });
    expect(result.success).toBe(true);
  });

  it("reason capped at 500 chars", () => {
    const result = periodLockBody.safeParse({ period: "2026-07", reason: "x".repeat(501) });
    expect(result.success).toBe(false);
    const result2 = periodLockBody.safeParse({ period: "2026-07", reason: "x".repeat(500) });
    expect(result2.success).toBe(true);
  });
});

describe("regularisationCreateBody — AT-17: regularisation validation", () => {
  const valid = {
    employeeId: VALID_EMP,
    date: "2026-07-15",
    requestedStatus: "present" as const,
    reason: "System was down, forgot to punch",
  };

  it("accepts valid regularisation request", () => {
    expect(regularisationCreateBody.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid employee UUID", () => {
    expect(regularisationCreateBody.safeParse({ ...valid, employeeId: "bad" }).success).toBe(false);
  });

  it("rejects invalid date format", () => {
    expect(regularisationCreateBody.safeParse({ ...valid, date: "15/07/2026" }).success).toBe(false);
  });

  it("rejects invalid status value", () => {
    expect(regularisationCreateBody.safeParse({ ...valid, requestedStatus: "late" }).success).toBe(false);
  });

  it("accepts all valid requested statuses", () => {
    for (const s of ["present", "absent", "half_day"]) {
      expect(regularisationCreateBody.safeParse({ ...valid, requestedStatus: s }).success).toBe(true);
    }
  });

  it("rejects blank reason", () => {
    expect(regularisationCreateBody.safeParse({ ...valid, reason: "" }).success).toBe(false);
  });

  it("rejects missing reason", () => {
    const { reason, ...noReason } = valid;
    expect(regularisationCreateBody.safeParse(noReason).success).toBe(false);
  });
});

describe("attendanceQueryParams", () => {
  it("accepts valid empId and month", () => {
    const result = attendanceQueryParams.safeParse({ empId: VALID_EMP, month: "2026-07" });
    expect(result.success).toBe(true);
  });

  it("both are optional", () => {
    expect(attendanceQueryParams.safeParse({}).success).toBe(true);
  });

  it("rejects invalid UUID for empId", () => {
    expect(attendanceQueryParams.safeParse({ empId: "not-uuid" }).success).toBe(false);
  });

  it("rejects invalid month format", () => {
    expect(attendanceQueryParams.safeParse({ month: "July 2026" }).success).toBe(false);
  });
});
