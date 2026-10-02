import { describe, it, expect } from "vitest";
import { canDownloadBankFile } from "./roles";

describe("canDownloadBankFile (GAP-FINANCE-PFMS-03)", () => {
  it("hides the bank file for audit/budget/procurement roles that the server would 403", () => {
    for (const r of ["audit_officer", "budget_officer", "procurement_officer", "payroll_admin"]) {
      expect(canDownloadBankFile([r])).toBe(false);
    }
  });
  it("allows the finance roles the route admits", () => {
    for (const r of ["finance_officer", "finance_admin", "super_admin"]) expect(canDownloadBankFile(["employee", r])).toBe(true);
  });
  it("does not hide when the session carries no role claim (server decides)", () => {
    expect(canDownloadBankFile([])).toBe(true);
  });
});
