import { describe, it, expect } from "vitest";
import { PAYROLL_PAY_DATA_ROLES, PAYROLL_RUN_READER_ROLES } from "./payrollRunRoles";
import { SALARY_ADMIN_ROLES as slipListRoles } from "@/app/(app)/hr/payroll/salary-slips/_salaryAdminRoles";
import { SALARY_ADMIN_ROLES as slipsDetailRoles } from "@/app/(app)/hr/payroll/slips/[id]/_salaryAdminRoles";
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

// UAT Phase 2 follow-up (security): per-employee pay data screens follow the same tier.
describe("PAYROLL_PAY_DATA_ROLES", () => {
  it("is payroll staff + hr_admin, and the salary-slip pages gate on it", () => {
    expect([...PAYROLL_PAY_DATA_ROLES].sort()).toEqual([...PAYROLL_ADMIN_ROLES, "hr_admin"].sort());
    expect([...slipListRoles].sort()).toEqual([...PAYROLL_PAY_DATA_ROLES].sort());
    expect([...slipsDetailRoles].sort()).toEqual([...PAYROLL_PAY_DATA_ROLES].sort());
  });
  it("excludes every finance role", () => {
    for (const r of ["finance_officer", "finance_admin", "budget_officer"]) expect(PAYROLL_PAY_DATA_ROLES).not.toContain(r);
  });
});
