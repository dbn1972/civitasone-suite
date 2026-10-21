import { describe, it, expect } from "vitest";
import { employeeDirectoryForRoles } from "./employeeDirectory";

// GAP-FINANCE-PAYMENTS-DETAIL-02: an eFile can be raised by finance_officer / finance_admin, but the HR
// employee directory is not open to them. The picker must ask a directory the role can reach.
describe("employeeDirectoryForRoles", () => {
  it("uses the HRMS directory for HR staff, managers, employees and payroll staff", () => {
    for (const r of ["hr_admin", "hr_officer", "super_admin", "manager", "employee", "payroll_admin", "payroll_officer"]) {
      expect(employeeDirectoryForRoles([r]), r).toBe("hrms");
    }
  });
  it("uses the payroll lookup for a finance_officer who holds no HRMS-directory role", () => {
    expect(employeeDirectoryForRoles(["finance_officer"])).toBe("payroll");
    expect(employeeDirectoryForRoles(["finance_officer", "audit_officer"])).toBe("payroll");
  });
  it("prefers the HRMS directory when the user has both kinds of role", () => {
    expect(employeeDirectoryForRoles(["finance_officer", "employee"])).toBe("hrms");
  });
  it("says there is no reachable directory for a finance_admin-only user", () => {
    expect(employeeDirectoryForRoles(["finance_admin"])).toBe("none");
    expect(employeeDirectoryForRoles(["finance_admin", "procurement_officer"])).toBe("none");
  });
  it("falls back to the default HRMS directory when roles are not known yet", () => {
    expect(employeeDirectoryForRoles([])).toBe("hrms");
  });
});
