import { describe, it, expect } from "vitest";
import { canWrite, VENDOR_WRITE_ROLES, RECURRING_WRITE_ROLES, BILL_CREATE_ROLES, ADVANCE_CREATE_ROLES, BILL_APPROVE_ROLES } from "./writeRoles";

describe("canWrite", () => {
  it("hides vendor writes from readers the server would 403", () => {
    for (const r of ["finance_officer", "audit_officer", "procurement_officer"]) expect(canWrite([r], VENDOR_WRITE_ROLES)).toBe(false);
    expect(canWrite(["finance_admin"], VENDOR_WRITE_ROLES)).toBe(true);
  });
  it("recurring writes admit finance_officer but not auditors", () => {
    expect(canWrite(["finance_officer"], RECURRING_WRITE_ROLES)).toBe(true);
    expect(canWrite(["audit_officer"], RECURRING_WRITE_ROLES)).toBe(false);
  });
  it("does not hide when there is no role claim (server decides)", () => {
    expect(canWrite([], VENDOR_WRITE_ROLES)).toBe(true);
  });
});

describe("bill / advance create + approve roles (GAP-FINANCE-EXPENDITURE-BILLS-05)", () => {
  it("hides + New Bill / + New Advance from read-only roles, offers it to finance_officer", () => {
    expect(canWrite(["audit_officer"], BILL_CREATE_ROLES)).toBe(false);
    expect(canWrite(["procurement_officer"], ADVANCE_CREATE_ROLES)).toBe(false);
    expect(canWrite(["budget_officer"], BILL_CREATE_ROLES)).toBe(false);
    expect(canWrite(["finance_officer"], BILL_CREATE_ROLES)).toBe(true);
    expect(canWrite(["finance_officer"], ADVANCE_CREATE_ROLES)).toBe(true);
  });
  it("Pass bill needs an approver role, not a plain finance_officer (BILLS-DETAIL-03)", () => {
    expect(canWrite(["finance_officer"], BILL_APPROVE_ROLES)).toBe(false);
    expect(canWrite(["accounts_officer"], BILL_APPROVE_ROLES)).toBe(true);
  });
});
