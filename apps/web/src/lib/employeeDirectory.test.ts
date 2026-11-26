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
  // The HRMS list is tenant-wide only for HR staff and payroll admin/officer; employee and manager are
  // scoped to direct reports by the service, so they must not displace the tenant-wide payroll lookup.
  it("keeps the tenant-wide payroll lookup for a finance_officer who also holds employee or manager", () => {
    expect(employeeDirectoryForRoles(["finance_officer", "employee"])).toBe("payroll");
    expect(employeeDirectoryForRoles(["finance_officer", "manager"])).toBe("payroll");
    expect(employeeDirectoryForRoles(["employee", "manager", "finance_officer"])).toBe("payroll");
  });
  it("prefers the tenant-wide HRMS directory when the user also holds a tenant-wide HRMS role", () => {
    expect(employeeDirectoryForRoles(["finance_officer", "hr_officer"])).toBe("hrms");
    expect(employeeDirectoryForRoles(["finance_officer", "payroll_officer"])).toBe("hrms");
    expect(employeeDirectoryForRoles(["finance_officer", "super_admin"])).toBe("hrms");
  });
  // B17: finance_admin is on the payroll lookup's role list, so it gets the same narrow tenant-wide lookup as finance_officer.
  it("uses the tenant-wide payroll lookup for a finance_admin, even one who also holds employee or manager", () => {
    expect(employeeDirectoryForRoles(["finance_admin"])).toBe("payroll");
    expect(employeeDirectoryForRoles(["finance_admin", "employee"])).toBe("payroll");
    expect(employeeDirectoryForRoles(["finance_admin", "manager"])).toBe("payroll");
    expect(employeeDirectoryForRoles(["finance_admin", "procurement_officer"])).toBe("payroll");
  });
  it("says there is no reachable directory for a role on neither list", () => {
    expect(employeeDirectoryForRoles(["accounts_officer"])).toBe("none");
    expect(employeeDirectoryForRoles(["procurement_officer"])).toBe("none");
  });
  it("falls back to the default HRMS directory when roles are not known yet", () => {
    expect(employeeDirectoryForRoles([])).toBe("hrms");
  });
});
