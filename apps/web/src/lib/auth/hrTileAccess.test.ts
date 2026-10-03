import { describe, it, expect } from "vitest";
import { HR_TILE_ROLE_OVERRIDES, hasHrTileAccess } from "./hrTileAccess";

/**
 * The complete set of tile hrefs on the HR hub (hr/page.tsx's hrCategories),
 * copied verbatim (88 slots across 13 categories, 86 unique hrefs -- leave
 * policies and holidays each appear once under their own category and once
 * again under Setup). Kept as a flat literal here, independent of
 * hrCategories itself, because hr/page.tsx cannot export that array (Next.js
 * App Router rejects any page-module export outside its recognised set --
 * see that file's own comment on exactly this). If hrCategories gains or
 * loses a tile, update this list too -- HR_HUB_HREFS_COVERAGE below fails
 * loudly if HR_TILE_ROLE_OVERRIDES ever references an href that isn't here,
 * but it cannot detect this list itself drifting from the real page.
 */
const ALL_HR_HUB_HREFS = [
  // catCore
  "/hr/dashboard", "/hr/employees", "/hr/directory", "/hr/org-chart", "/hr/id-cards",
  // catAttendanceTime
  "/hr/attendance", "/hr/attendance/regularisation", "/hr/checkin-log", "/hr/shifts",
  "/hr/shift-requests", "/hr/wfh", "/hr/holidays",
  // catLeave
  "/hr/leave", "/hr/leave/apply", "/hr/leave-policies", "/hr/overtime",
  // catPayroll (30)
  "/hr/payroll", "/hr/payroll/salary-slips", "/hr/payroll/structures", "/hr/pay-matrix",
  "/hr/payroll/gpf", "/hr/payroll/nps", "/hr/payroll/pensioners",
  "/hr/payroll/form16", "/hr/payroll/statutory", "/hr/payroll/ddos", "/hr/payroll/fnf",
  "/hr/payroll/loans", "/hr/payroll/off-cycle", "/hr/payroll/tax-declaration",
  "/hr/payroll/income-tax", "/hr/payroll/returns", "/hr/payroll/tax-config",
  "/hr/payroll/salary-revisions", "/hr/payroll/corrections", "/hr/payroll/arrears",
  "/hr/payroll/bonus", "/hr/payroll/reimbursements", "/hr/payroll/pay-groups",
  "/hr/payroll/ctc", "/hr/payroll/flex-benefits", "/hr/payroll/costing",
  "/hr/payroll/register", "/hr/payroll/comparison", "/hr/payroll/period",
  "/hr/payroll/disbursement",
  // catBenefits
  "/hr/benefits", "/hr/loans", "/hr/advances", "/hr/expenses", "/hr/travel", "/hr/medical",
  // catRecruitment
  "/hr/recruitment", "/hr/onboarding",
  // catPerformance
  "/hr/apar", "/hr/goals", "/hr/training", "/hr/skills", "/hr/certifications",
  "/hr/competency", "/hr/work-summary",
  // catLifecycle
  "/hr/service-book", "/hr/transfer", "/hr/promotion", "/hr/deputation",
  "/hr/confirmation", "/hr/retirement", "/hr/dpc",
  // catRelations
  "/hr/grievance", "/hr/vigilance", "/hr/disciplinary", "/hr/icc",
  // catWorkforce
  "/hr/staffing-plan", "/hr/contractual", "/hr/outsourced", "/hr/interns",
  "/hr/workforce", "/hr/succession",
  // catCompliance
  "/hr/rti",
  // catCommunication
  "/hr/social-feed",
  // catSetup (leave-policies, holidays repeat from above)
  "/hr/departments", "/hr/designations", "/hr/locations", "/hr/office-locations", "/hr/leave-policies",
  "/hr/holidays", "/hr/employee-types", "/hr/audit-log",
];

const UNIQUE_HR_HUB_HREFS = Array.from(new Set(ALL_HR_HUB_HREFS));

// The hrefs GAP-HR-HOME-01 hides from a plain "employee" (see
// hrTileAccess.ts for the evidence behind each one).
const HIDDEN_FROM_EMPLOYEE = [
  "/hr/advances",
  "/hr/icc",
  "/hr/employee-types",
  "/hr/id-cards",
  "/hr/interns",
  "/hr/outsourced", // GAP-HR-OUTSOURCED-01: HR-only register (contract values)
  "/hr/office-locations",
  "/hr/leave-policies",
  "/hr/onboarding",
  "/hr/rti",
  "/hr/vigilance",
  "/hr/disciplinary",
  "/hr/work-summary",
  "/hr/payroll",
  "/hr/audit-log",
  "/hr/payroll/salary-slips",
  "/hr/payroll/pensioners",
  "/hr/payroll/structures",
];

describe("hasHrTileAccess", () => {
  it("has exactly 88 tile slots / 86 unique hrefs today (update ALL_HR_HUB_HREFS if hr/page.tsx's hrCategories changes)", () => {
    expect(ALL_HR_HUB_HREFS.length).toBe(88);
    expect(UNIQUE_HR_HUB_HREFS.length).toBe(86);
  });

  it("GAP-HR-HOME-01 acceptance: hr_admin still sees all 86 tiles", () => {
    for (const href of UNIQUE_HR_HUB_HREFS) {
      expect(hasHrTileAccess(href, ["hr_admin"])).toBe(true);
    }
  });

  it("GAP-HR-HOME-01 acceptance: employee sees no Payroll Runs/Vigilance/Disciplinary/Audit Log tiles", () => {
    expect(hasHrTileAccess("/hr/payroll", ["employee"])).toBe(false);
    expect(hasHrTileAccess("/hr/vigilance", ["employee"])).toBe(false);
    expect(hasHrTileAccess("/hr/disciplinary", ["employee"])).toBe(false);
    expect(hasHrTileAccess("/hr/audit-log", ["employee"])).toBe(false);
  });

  it("employee is denied exactly the evidenced set, and no other tile", () => {
    for (const href of UNIQUE_HR_HUB_HREFS) {
      const expected = !HIDDEN_FROM_EMPLOYEE.includes(href);
      expect(hasHrTileAccess(href, ["employee"])).toBe(expected);
    }
  });

  it("GAP-HR-INTERNS-04: interns register is HR staff + manager only", () => {
    expect(hasHrTileAccess("/hr/interns", ["employee"])).toBe(false);
    expect(hasHrTileAccess("/hr/interns", ["manager"])).toBe(true);
    expect(hasHrTileAccess("/hr/interns", ["hr_officer"])).toBe(true);
  });

  it("GAP-HR-LOCATIONS-NEW-02: office geofences are offered only to the roles that may create them", () => {
    expect(hasHrTileAccess("/hr/office-locations", ["hr_officer"])).toBe(false);
    expect(hasHrTileAccess("/hr/office-locations", ["hr_admin"])).toBe(true);
  });

  it("apar stays visible to employee (APAR_ROLES admits self-service employee/manager)", () => {
    expect(hasHrTileAccess("/hr/apar", ["employee"])).toBe(true);
    expect(hasHrTileAccess("/hr/apar", ["manager"])).toBe(true);
  });

  it("manager keeps today's access to payroll runs and audit log (only employee is newly hidden)", () => {
    expect(hasHrTileAccess("/hr/payroll", ["manager"])).toBe(true);
    expect(hasHrTileAccess("/hr/audit-log", ["manager"])).toBe(true);
  });

  it("a role with no overlap with any override, and not admitted by hr/layout.tsx in the first place, does not spuriously gain access", () => {
    expect(hasHrTileAccess("/hr/disciplinary", ["citizen"])).toBe(false);
  });

  it("an href with no override entry is unrestricted (unchanged status quo)", () => {
    expect(hasHrTileAccess("/hr/dashboard", ["employee"])).toBe(true);
    expect(hasHrTileAccess("/hr/holidays", ["employee"])).toBe(true);
    expect(hasHrTileAccess("/hr/some-future-tile-not-yet-mapped", [])).toBe(true);
  });

  it("every override's role list is non-empty and includes at least one admin-tier role, so no entry can lock out both hr_admin and super_admin", () => {
    for (const [href, roles] of Object.entries(HR_TILE_ROLE_OVERRIDES)) {
      expect(roles.length, `${href} has an empty role list`).toBeGreaterThan(0);
      expect(
        roles.includes("hr_admin") || roles.includes("super_admin"),
        `${href} excludes both hr_admin and super_admin`,
      ).toBe(true);
    }
  });

  it("every override key is a real hub href (guards against a stale or typo'd href)", () => {
    for (const href of Object.keys(HR_TILE_ROLE_OVERRIDES)) {
      expect(UNIQUE_HR_HUB_HREFS, `${href} is not in ALL_HR_HUB_HREFS`).toContain(href);
    }
  });
});
