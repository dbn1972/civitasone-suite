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
