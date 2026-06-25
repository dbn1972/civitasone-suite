import { describe, it, expect } from "vitest";
import {
  EMPLOYEE_STATUSES,
  employeeStatusEnum,
  SERVING_STATUSES,
  isEmployeeStatus,
} from "../src/modules/employee/status.js";

// P1-5: locks the employee status contract end-to-end. The same 8 lowercase
// values are enforced by the DB CHECK constraint in migration 0025.
describe("employee status contract (P1-5)", () => {
  it("is exactly the 8 canonical lowercase values (matches the DB CHECK set)", () => {
    expect([...EMPLOYEE_STATUSES]).toEqual([
      "probation",
      "confirmed",
      "on_leave",
      "suspended",
      "deputation",
      "retired",
      "separated",
      "terminated",
    ]);
    // all lowercase, no synthetic "active"
    for (const s of EMPLOYEE_STATUSES) expect(s).toBe(s.toLowerCase());
    expect((EMPLOYEE_STATUSES as readonly string[]).includes("active")).toBe(false);
  });

  it("zod enum accepts canonical and rejects the old mixed-case/legacy values", () => {
    expect(employeeStatusEnum.safeParse("confirmed").success).toBe(true);
    expect(employeeStatusEnum.safeParse("on_leave").success).toBe(true);
    expect(employeeStatusEnum.safeParse("separated").success).toBe(true);
    // the casing the normalization hack used to paper over:
    expect(employeeStatusEnum.safeParse("Active").success).toBe(false);
    expect(employeeStatusEnum.safeParse("active").success).toBe(false);
    expect(employeeStatusEnum.safeParse("On_Leave").success).toBe(false);
  });

  it("serving headcount is the probation/confirmed/deputation set", () => {
    expect(SERVING_STATUSES.has("confirmed")).toBe(true);
    expect(SERVING_STATUSES.has("probation")).toBe(true);
    expect(SERVING_STATUSES.has("separated")).toBe(false);
    expect(SERVING_STATUSES.has("retired")).toBe(false);
  });

  it("isEmployeeStatus narrows correctly", () => {
    expect(isEmployeeStatus("confirmed")).toBe(true);
    expect(isEmployeeStatus("Active")).toBe(false);
  });
});
