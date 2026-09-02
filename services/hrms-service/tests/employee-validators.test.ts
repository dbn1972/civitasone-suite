/**
 * HRMS Pack #03 — Employee Lifecycle: Validator + status contract tests.
 *
 * Covers EM-02 (field boundary validation), EM-09 (invalid status transitions),
 * EM-11 (sensitive field validation), status contract, and serving headcount.
 *
 * Source: modules/employee/validators.ts, modules/employee/status.ts
 */
import { describe, it, expect } from "vitest";
import {
  createEmployeeBody,
  confirmEmployeeBody,
  updateEmployeeBody,
  idParam,
} from "../src/modules/employee/validators.js";
import {
  EMPLOYEE_STATUSES,
  SERVING_STATUSES,
  isEmployeeStatus,
  employeeStatusEnum,
} from "../src/modules/employee/status.js";

describe("createEmployeeBody — EM-02: required field boundaries", () => {
  const valid = {
    employeeNo: "EMP-001",
    fullName: "Test Employee",
    departmentId: "42000000-dddd-4000-8000-000000000001",
    designationId: "62000000-ffff-4000-8000-000000000001",
    dateOfJoining: "2026-01-15",
  };

  it("accepts valid minimum required fields", () => {
    expect(createEmployeeBody.safeParse(valid).success).toBe(true);
  });

  it("rejects empty employee number", () => {
    expect(createEmployeeBody.safeParse({ ...valid, employeeNo: "" }).success).toBe(false);
  });

  it("rejects employee number exceeding 32 chars", () => {
    expect(createEmployeeBody.safeParse({ ...valid, employeeNo: "x".repeat(33) }).success).toBe(false);
  });

  it("rejects empty fullName", () => {
    expect(createEmployeeBody.safeParse({ ...valid, fullName: "" }).success).toBe(false);
  });

  it("rejects fullName exceeding 256 chars", () => {
    expect(createEmployeeBody.safeParse({ ...valid, fullName: "x".repeat(257) }).success).toBe(false);
  });

  it("rejects non-UUID departmentId", () => {
    expect(createEmployeeBody.safeParse({ ...valid, departmentId: "bad" }).success).toBe(false);
  });

  it("rejects non-UUID designationId", () => {
    expect(createEmployeeBody.safeParse({ ...valid, designationId: "bad" }).success).toBe(false);
  });

  it("rejects invalid dateOfJoining format", () => {
    expect(createEmployeeBody.safeParse({ ...valid, dateOfJoining: "15/01/2026" }).success).toBe(false);
    expect(createEmployeeBody.safeParse({ ...valid, dateOfJoining: "2026" }).success).toBe(false);
  });

  it("rejects invalid PAN format", () => {
    expect(createEmployeeBody.safeParse({ ...valid, pan: "12345" }).success).toBe(false);
    expect(createEmployeeBody.safeParse({ ...valid, pan: "abcde1234a" }).success).toBe(false); // lowercase
  });

  it("accepts valid PAN", () => {
    expect(createEmployeeBody.safeParse({ ...valid, pan: "ABCDE1234F" }).success).toBe(true);
  });

  it("rejects invalid email", () => {
    expect(createEmployeeBody.safeParse({ ...valid, email: "not-email" }).success).toBe(false);
  });

  it("accepts valid email", () => {
    expect(createEmployeeBody.safeParse({ ...valid, email: "test@example.com" }).success).toBe(true);
  });

  it("rejects negative basicMinor", () => {
    expect(createEmployeeBody.safeParse({ ...valid, basicMinor: -100 }).success).toBe(false);
  });

  it("rejects non-3-char currency", () => {
    expect(createEmployeeBody.safeParse({ ...valid, currency: "IN" }).success).toBe(false);
    expect(createEmployeeBody.safeParse({ ...valid, currency: "INRS" }).success).toBe(false);
  });

  it("defaults employeeType to permanent", () => {
    const result = createEmployeeBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.employeeType).toBe("permanent");
  });

  it("defaults currency to INR", () => {
    const result = createEmployeeBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe("INR");
  });

  it("defaults basicMinor to 0", () => {
    const result = createEmployeeBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.basicMinor).toBe(0);
  });
});

describe("confirmEmployeeBody — EM-09: confirmation validation", () => {
  it("accepts valid YYYY-MM-DD date", () => {
    expect(confirmEmployeeBody.safeParse({ confirmationDate: "2026-07-01" }).success).toBe(true);
  });

  it("rejects invalid date format", () => {
    expect(confirmEmployeeBody.safeParse({ confirmationDate: "01/07/2026" }).success).toBe(false);
    expect(confirmEmployeeBody.safeParse({ confirmationDate: "2026-7-1" }).success).toBe(false);
  });

  it("rejects missing confirmationDate", () => {
    expect(confirmEmployeeBody.safeParse({}).success).toBe(false);
  });
});

describe("updateEmployeeBody — EM-11: sensitive field validation", () => {
  it("rejects invalid email", () => {
    expect(updateEmployeeBody.safeParse({ email: "bad" }).success).toBe(false);
  });

  it("rejects mobile exceeding 20 chars", () => {
    expect(updateEmployeeBody.safeParse({ mobile: "1".repeat(21) }).success).toBe(false);
  });

  it("rejects invalid managerId UUID", () => {
    expect(updateEmployeeBody.safeParse({ managerId: "not-uuid" }).success).toBe(false);
  });

  it("rejects ESIC exceeding 17 chars", () => {
    expect(updateEmployeeBody.safeParse({ esicIpNumber: "1".repeat(18) }).success).toBe(false);
  });

  it("rejects PRAN exceeding 12 chars", () => {
    expect(updateEmployeeBody.safeParse({ pran: "1".repeat(13) }).success).toBe(false);
  });

  it("rejects GSTIN exceeding 15 chars", () => {
    expect(updateEmployeeBody.safeParse({ gstin: "1".repeat(16) }).success).toBe(false);
  });

  it("accepts valid update with mobile and email", () => {
    expect(updateEmployeeBody.safeParse({
      mobile: "9876543210",
      email: "new@example.com",
    }).success).toBe(true);
  });

  it("accepts empty object (all optional)", () => {
    expect(updateEmployeeBody.safeParse({}).success).toBe(true);
  });

  // HR-A deep-verify finding: basicMinor was declared `z.bigint()`, which can
  // never successfully parse a real HTTP JSON request body -- JSON has no
  // bigint literal, so `JSON.parse` always produces a plain `number` here,
  // and zod's bigint schema rejects that with "Expected bigint, received
  // number". Every PATCH that included basicMinor 400'd unconditionally.
  it("accepts a plain JSON number for basicMinor (regression: was z.bigint(), which JSON can never satisfy)", () => {
    const result = updateEmployeeBody.safeParse({ basicMinor: 5000000 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.basicMinor).toBe(5000000);
  });

  it("rejects a negative basicMinor", () => {
    expect(updateEmployeeBody.safeParse({ basicMinor: -1 }).success).toBe(false);
  });

  it("rejects a non-integer basicMinor", () => {
    expect(updateEmployeeBody.safeParse({ basicMinor: 1.5 }).success).toBe(false);
  });
});

describe("EMPLOYEE_STATUSES — status contract", () => {
  it("declares exactly 9 statuses", () => {
    expect(EMPLOYEE_STATUSES).toHaveLength(9);
  });

  it("contains all expected statuses", () => {
    const expected = ["probation", "confirmed", "on_leave", "suspended", "deputation", "retired", "separated", "terminated", "no_show"];
    for (const s of expected) {
      expect(EMPLOYEE_STATUSES).toContain(s);
    }
  });

  it("isEmployeeStatus returns true for valid, false for invalid", () => {
    expect(isEmployeeStatus("confirmed")).toBe(true);
    expect(isEmployeeStatus("active")).toBe(false);
    expect(isEmployeeStatus("Active")).toBe(false); // case-sensitive
  });

  it("employeeStatusEnum validates correctly", () => {
    expect(employeeStatusEnum.safeParse("probation").success).toBe(true);
    expect(employeeStatusEnum.safeParse("fired").success).toBe(false);
  });
});

describe("SERVING_STATUSES — headcount contract", () => {
  it("only probation, confirmed, deputation count as serving", () => {
    expect(SERVING_STATUSES.has("probation")).toBe(true);
    expect(SERVING_STATUSES.has("confirmed")).toBe(true);
    expect(SERVING_STATUSES.has("deputation")).toBe(true);
  });

  it("non-serving statuses are excluded", () => {
    expect(SERVING_STATUSES.has("retired")).toBe(false);
    expect(SERVING_STATUSES.has("separated")).toBe(false);
    expect(SERVING_STATUSES.has("terminated")).toBe(false);
    expect(SERVING_STATUSES.has("suspended")).toBe(false);
    expect(SERVING_STATUSES.has("on_leave")).toBe(false);
  });
});

describe("idParam", () => {
  it("accepts valid UUID", () => {
    expect(idParam.safeParse({ id: "32000000-cccc-4000-8000-000000000001" }).success).toBe(true);
  });

  it("rejects non-UUID", () => {
    expect(idParam.safeParse({ id: "bad" }).success).toBe(false);
  });
});
