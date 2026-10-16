import { describe, it, expect } from "vitest";
import {
  EMPLOYEE_ADMIN_ROLES,
  HR_STAFF_ROLES,
  HR_ADMIN_TIER_ROLES,
  HR_MASTERS_ADMIN_ROLES,
  HR_STAFF_MANAGER_ROLES,
  HR_SELF_SERVICE_ROLES,
  HR_FINANCE_DECIDER_ROLES,
  HR_LOANS_ROLES,
  HR_ADVANCE_ROLES,
  ID_CARD_ROLES,
  ICC_ACCESS_ROLES,
  HR_ROLES,
  PAYROLL_SALARY_ADMIN_ROLES,
  PAYROLL_STAFF_ROLES,
  AUDIT_LOG_READER_ROLES,
  HR_LOCATION_ADMIN_ROLES,
  PAYROLL_EMPLOYEE_ROLES,
  PAYROLL_HR_READER_ROLES,
  FNF_COMPUTE_ROLES,
  FNF_READ_ROLES,
  FNF_SUBMIT_ROLES,
  FNF_FINANCE_APPROVE_ROLES,
  FNF_DISBURSE_ROLES,
  HR_EXPENSE_DECIDE_ROLES,
} from "./workRoles";

const sorted = (a: readonly string[]) => [...a].sort();

// W1 SF-09a: each tier mirrors an hrms-service requireRole list. The
// route-by-route comparison is tests/contract/hr-role-matrix.contract.test.ts;
// this pins the tier values so a silent edit here is a deliberate one.
describe("shared HR role tiers", () => {
  it("pins each tier to the backend list it mirrors", () => {
    expect(sorted(HR_STAFF_ROLES)).toEqual(["hr_admin", "hr_officer", "super_admin"]);
    expect(sorted(EMPLOYEE_ADMIN_ROLES)).toEqual(sorted(HR_STAFF_ROLES));
    expect(sorted(HR_ADMIN_TIER_ROLES)).toEqual(["hr_admin", "super_admin"]);
    expect(sorted(HR_MASTERS_ADMIN_ROLES)).toEqual(["admin", "hr_admin", "super_admin"]);
    expect(sorted(HR_STAFF_MANAGER_ROLES)).toEqual(["hr_admin", "hr_officer", "manager", "super_admin"]);
    expect(sorted(HR_SELF_SERVICE_ROLES)).toEqual(["employee", "hr_admin", "hr_officer", "manager", "super_admin"]);
    expect(sorted(HR_FINANCE_DECIDER_ROLES)).toEqual(["finance_admin", "hr_admin", "hr_officer", "super_admin"]);
    expect(sorted(HR_LOANS_ROLES)).toEqual(["finance_admin", "hr_admin", "hr_officer", "manager", "officer", "super_admin"]);
    expect(sorted(HR_ADVANCE_ROLES)).toEqual(["employee", "finance_admin", "hr_admin", "hr_officer", "manager", "officer", "super_admin"]);
    expect(sorted(ID_CARD_ROLES)).toEqual(["hr_admin", "security_admin", "super_admin"]);
    expect(sorted(ICC_ACCESS_ROLES)).toEqual(["hr_admin", "icc_member", "super_admin"]);
  });

  it("every tier is reachable through the shared /hr layout gate", () => {
    const tiers = [
      HR_STAFF_ROLES, HR_ADMIN_TIER_ROLES, HR_MASTERS_ADMIN_ROLES, HR_STAFF_MANAGER_ROLES,
      HR_SELF_SERVICE_ROLES, HR_FINANCE_DECIDER_ROLES, HR_LOANS_ROLES, HR_ADVANCE_ROLES, ICC_ACCESS_ROLES,
    ];
    // security_admin (id-cards) is deliberately outside the layout union; it is
    // tracked as its own page-level gate, not asserted here.
    for (const tier of tiers) for (const role of tier) expect(HR_ROLES).toContain(role);
  });
});

// W1 SF-09c: pin new shared tiers so a silent edit is a deliberate one.
describe("W1 SF-09c new shared role tiers", () => {
  it("pins each new tier to its backend list", () => {
    expect(sorted(AUDIT_LOG_READER_ROLES)).toEqual(sorted(["audit_officer", "audit_admin", "super_admin", "platform_admin"]));
    expect(sorted(HR_LOCATION_ADMIN_ROLES)).toEqual(sorted(["location_user", "location_admin", "super_admin", "admin", "hr_admin"]));
    expect(sorted(FNF_COMPUTE_ROLES)).toEqual(sorted(["payroll_admin", "hr_admin", "super_admin", "finance_officer"]));
    expect(sorted(FNF_READ_ROLES)).toEqual(sorted(["payroll_admin", "hr_admin", "super_admin", "finance_officer", "payroll_officer"]));
    expect(sorted(FNF_SUBMIT_ROLES)).toEqual(sorted(["payroll_admin", "payroll_officer"]));
    expect(sorted(FNF_FINANCE_APPROVE_ROLES)).toEqual(sorted(["finance_officer", "payroll_admin"]));
    expect(sorted(FNF_DISBURSE_ROLES)).toEqual(sorted(["payroll_admin", "super_admin"]));
    expect(sorted(HR_EXPENSE_DECIDE_ROLES)).toEqual(sorted(["manager", "hr_admin", "finance_officer", "super_admin"]));
  });

  it("PAYROLL_EMPLOYEE_ROLES is PAYROLL_SALARY_ADMIN_ROLES plus employee", () => {
    expect(sorted(PAYROLL_EMPLOYEE_ROLES)).toEqual(sorted([...PAYROLL_SALARY_ADMIN_ROLES, "employee"]));
  });

  it("PAYROLL_HR_READER_ROLES is PAYROLL_STAFF_ROLES plus hr_admin", () => {
    expect(sorted(PAYROLL_HR_READER_ROLES)).toEqual(sorted([...PAYROLL_STAFF_ROLES, "hr_admin"]));
  });

  it("FNF_READ_ROLES is a superset of FNF_COMPUTE_ROLES", () => {
    for (const role of FNF_COMPUTE_ROLES) expect(FNF_READ_ROLES).toContain(role);
  });
});
