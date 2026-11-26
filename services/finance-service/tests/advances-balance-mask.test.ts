/**
 * C25 / GAP-FINANCE-EXPENDITURE-ADVANCES-03: personal-advance balances are withheld from roles outside ADVANCE_BALANCE_ROLES.
 */
import { describe, it, expect } from "vitest";
import { maskAdvanceBalances, ADVANCE_BALANCE_ROLES } from "../src/modules/payments/domain.js";
import { createAdvanceBody } from "../src/modules/payments/validators.js";

describe("maskAdvanceBalances", () => {
  const rows = [
    { type: "employee", amount: "250000", adjustedAmount: "50000", balance: "200000" },
    { type: "vendor", amount: "900000", adjustedAmount: "0", balance: "900000" },
  ];
  it("the entitled roles (finance_officer / finance_admin / super_admin / payroll_admin / payroll_officer) see everything, same array", () => {
    expect([...ADVANCE_BALANCE_ROLES].sort()).toEqual(["finance_admin", "finance_officer", "payroll_admin", "payroll_officer", "super_admin"]);
    for (const role of ADVANCE_BALANCE_ROLES) expect(maskAdvanceBalances(rows, [role])).toBe(rows);
  });
  it("other readers get null figures + balancesMasked on EMPLOYEE advances only; vendor advances are untouched", () => {
    for (const role of ["accounts_officer", "audit_officer", "procurement_officer"]) {
      const out = maskAdvanceBalances(rows, [role]);
      expect(out[0]).toEqual({ type: "employee", amount: null, adjustedAmount: null, balance: null, balancesMasked: true });
      expect(out[1]).toEqual(rows[1]);
    }
  });
  it("no roles at all is masked too (fail closed)", () => {
    expect(maskAdvanceBalances(rows, [])[0]!.balance).toBeNull();
  });
});

describe("createAdvanceBody recoveryMode", () => {
  const base = { advanceNo: "ADV-2026-0042", purpose: "Tour advance", payee: "R. K. Iyer", amountMinor: "2500000", sanctionAuthority: "Under Secretary (Admin)", reason: "Official tour to Pune" };
  it("accepts the three modes, none, and refuses salary recovery for a non-officer advance", () => {
    const parse = (b: unknown): boolean => createAdvanceBody.safeParse(b).success;
    expect(parse({ ...base, type: "employee", recoveryMode: "salary" })).toBe(true);
    expect(parse({ ...base, type: "employee", recoveryMode: "cash" })).toBe(true);
    expect(parse({ ...base, type: "vendor", recoveryMode: "adjust_against_bill" })).toBe(true);
    expect(parse({ ...base, type: "employee" })).toBe(true);
    expect(parse({ ...base, type: "vendor", recoveryMode: "salary" })).toBe(false);
    expect(parse({ ...base, type: "employee", recoveryMode: "barter" })).toBe(false);
  });
});
