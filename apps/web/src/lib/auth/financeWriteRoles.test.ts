import { describe, it, expect } from "vitest";
import { FINANCE_ROLES, HR_ROLES, OPENING_BALANCE_WRITE_ROLES, PAYMENT_WRITE_ROLES } from "./workRoles";

describe("finance write-role constants (GAP-FINANCE-OPENING-BALANCES-04 / PAYMENTS-04)", () => {
  it("opening balances: finance_admin/super_admin only (masters/fy-routes.ts WRITER_ROLES)", () => {
    expect([...OPENING_BALANCE_WRITE_ROLES]).toEqual(["finance_admin", "super_admin"]);
  });
  it("payments: finance_officer/finance_admin/super_admin (payments/routes.ts FINANCE_ROLES)", () => {
    expect([...PAYMENT_WRITE_ROLES]).toEqual(["finance_officer", "finance_admin", "super_admin"]);
  });
  it("every write role can reach the finance module at all", () => {
    for (const r of [...OPENING_BALANCE_WRITE_ROLES, ...PAYMENT_WRITE_ROLES]) {
      expect((FINANCE_ROLES as readonly string[]).includes(r)).toBe(true);
    }
  });
});

// GAP-FINANCE-MEDICAL-01: /finance/medical redirects to /hr/medical, whose layout gate is HR_ROLES and whose
// API (hrms medical/routes.ts HR_ROLES) admits finance_officer. If HR_ROLES drops the finance roles, the
// redirect lands a finance-only user on "Access restricted".
describe("HR layout gate admits the finance roles the medical API admits (GAP-FINANCE-MEDICAL-01)", () => {
  it.each(["finance_officer", "finance_admin"])("%s can pass the /hr layout guard", (role) => {
    expect(HR_ROLES).toContain(role);
  });
});
