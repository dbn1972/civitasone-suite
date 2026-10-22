import { describe, it, expect } from "vitest";
import { PAYROLL_READER_ROLES as WORK_ROLES_COPY } from "./workRoles";
import { PAYROLL_READER_ROLES } from "./roleGuard";

// GAP-HR-DASHBOARD-05: workRoles carries a copy of roleGuard's payroll-reader
// tier so the HR dashboard (whose page test mocks roleGuard) can gate its
// "Run Payroll" quick action on whether /hr/payroll will actually open. A copy
// can drift; this is the check that stops it.
describe("workRoles.PAYROLL_READER_ROLES", () => {
  it("is the same role set as roleGuard.PAYROLL_READER_ROLES", () => {
    expect([...WORK_ROLES_COPY].sort()).toEqual([...PAYROLL_READER_ROLES].sort());
  });

  it("does not admit manager or hr_officer, who get PermissionDenied on /hr/payroll", () => {
    expect(WORK_ROLES_COPY).not.toContain("manager");
    expect(WORK_ROLES_COPY).not.toContain("hr_officer");
  });
});
