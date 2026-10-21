import { describe, it, expect } from "vitest";
import { ACCOUNT_HEAD_WRITE_ROLES, FINANCE_ROLES, HR_ROLES, OPENING_BALANCE_WRITE_ROLES, PAYMENT_WRITE_ROLES } from "./workRoles";

describe("finance write-role constants (GAP-FINANCE-OPENING-BALANCES-04 / PAYMENTS-04)", () => {
  it("opening balances: finance_admin/super_admin only (masters/fy-routes.ts WRITER_ROLES)", () => {
    expect([...OPENING_BALANCE_WRITE_ROLES]).toEqual(["finance_admin", "super_admin"]);
  });
  it("payments: finance_officer/finance_admin/super_admin (payments/routes.ts FINANCE_ROLES)", () => {
    expect([...PAYMENT_WRITE_ROLES]).toEqual(["finance_officer", "finance_admin", "super_admin"]);
  });
  it("chart of accounts: finance_officer/finance_admin/super_admin (budget/routes.ts POST + PATCH /v1/finance/accounts)", () => {
    expect([...ACCOUNT_HEAD_WRITE_ROLES]).toEqual(["finance_officer", "finance_admin", "super_admin"]);
    // the read-only finance roles are NOT writers (they would only get a 403 after filling the form)
    for (const r of ["audit_officer", "budget_officer", "procurement_officer", "accounts_officer", "payroll_admin", "tenant_admin", "admin"]) {
      expect((ACCOUNT_HEAD_WRITE_ROLES as readonly string[]).includes(r), r).toBe(false);
    }
  });
  it("every write role can reach the finance module at all", () => {
    for (const r of [...OPENING_BALANCE_WRITE_ROLES, ...PAYMENT_WRITE_ROLES, ...ACCOUNT_HEAD_WRITE_ROLES]) {
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
