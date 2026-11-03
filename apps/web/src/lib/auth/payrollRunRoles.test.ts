import { describe, it, expect } from "vitest";
import { PAYROLL_RUN_READER_ROLES } from "./payrollRunRoles";
import { PAYROLL_ADMIN_ROLES } from "./roleGuard";

// UAT Phase 2 C8 (security): finance roles must not open payroll runs.
describe("PAYROLL_RUN_READER_ROLES", () => {
  it("is payroll staff + hr_admin only", () => {
    expect([...PAYROLL_RUN_READER_ROLES].sort()).toEqual([...PAYROLL_ADMIN_ROLES, "hr_admin"].sort());
  });
  it("excludes finance_officer, finance_admin, manager and employee", () => {
    for (const r of ["finance_officer", "finance_admin", "manager", "employee"]) expect(PAYROLL_RUN_READER_ROLES).not.toContain(r);
  });
});
