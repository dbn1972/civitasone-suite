import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NAV_GROUPS, SELF_SERVICE_ITEMS, activeNavHref, isNavItemVisible, visibleNavGroups } from "./navModel";

/**
 * UAT-P3 (S-02 / NAV-02): the sidebar lacked HR & Payroll, Revenue, Billing and
 * Meetings for the UAT officer although every one of those pages opened,
 * because it matched module keys exactly while the composition projection
 * emits gateway keys ("hrms-payroll", revenue -> "finance") and ModuleGate
 * matches leniently with a super_admin bypass. These pin the shared model.
 */
const APP = join(process.cwd(), "src/app/(app)");
// The shape of a composed tenant projection (admin-service gateway-map.ts toGatewayKeys).
const COMPOSED = ["billing", "finance", "hrms-attendance", "hrms-leave", "hrms-payroll", "meeting", "payroll", "procurement", "workflow"];
const groupIds = (access: Parameters<typeof visibleNavGroups>[0]) => visibleNavGroups(access).map((g) => g.id);
const itemIds = (access: Parameters<typeof visibleNavGroups>[0]) => visibleNavGroups(access).flatMap((g) => g.items.map((i) => i.id));

describe("navigation model (UAT-P3 S-02)", () => {
  it("every entry links to a real App Router page", () => {
    const missing = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !existsSync(join(APP, i.href, "page.tsx")));
    expect(missing.map((i) => i.href)).toEqual([]);
  });

  it("ids are unique (React keys, icons and message keys)", () => {
    const ids = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    const gids = NAV_GROUPS.map((g) => g.id);
    expect(new Set(gids).size).toBe(gids.length);
  });

  it("has the HR & Payroll, Revenue, Billing and Meetings sections built from real routes", () => {
    const byId = Object.fromEntries(NAV_GROUPS.map((g) => [g.id, g.items.map((i) => i.href)]));
    expect(byId.hrPayroll).toEqual(expect.arrayContaining(["/hr", "/hr/employees", "/hr/leave/approvals", "/hr/payroll"]));
    expect(byId.revenue).toEqual(expect.arrayContaining(["/revenue", "/revenue/assessments", "/revenue/receipts"]));
    expect(byId.billing).toEqual(expect.arrayContaining(["/billing", "/billing/invoices"]));
    expect(byId.meetings).toEqual(expect.arrayContaining(["/meeting", "/meeting/meetings", "/meeting/meetings/new"]));
  });

  it("a super_admin on a composed tenant sees all four sections (the UAT officer saw none)", () => {
    const ids = groupIds({ enabledModules: COMPOSED, roles: ["super_admin"] });
    expect(ids).toEqual(expect.arrayContaining(["hrPayroll", "revenue", "billing", "meetings", "selfService"]));
  });

  it("an hr_admin sees HR & Payroll when the tenant list carries only hrms-* keys", () => {
    expect(itemIds({ enabledModules: ["hrms-payroll", "hrms-leave"], roles: ["hr_admin"] })).toContain("hr");
  });

  it("Revenue shows for a revenue officer when composition projects revenue to the finance key", () => {
    expect(itemIds({ enabledModules: ["finance"], roles: ["revenue_officer"] })).toContain("revenue");
    expect(itemIds({ enabledModules: ["procurement"], roles: ["revenue_officer"] })).not.toContain("revenue");
  });

  it("a plain employee gets the five self-service entries and none of the staff screens", () => {
    const ids = itemIds({ enabledModules: COMPOSED, roles: ["employee"] });
    expect(ids).toEqual(expect.arrayContaining(["myLeave", "myPayslips", "myAttendance", "myTaxDeclaration", "myProfile"]));
    for (const staff of ["hr", "hrEmployees", "hrLeaveApprovals", "hrPayrollRuns", "hrSalarySlips", "hrDdos", "revenue", "billing", "finance", "meetingNew", "meetingAdmin", "administration"]) {
      expect(ids, staff).not.toContain(staff);
    }
  });

  it("the self-service menu is exactly the five employee tasks", () => {
    expect(SELF_SERVICE_ITEMS.map((i) => i.label)).toEqual(["My leave", "My payslips", "My attendance", "My tax declaration", "My profile"]);
  });

  it("a standalone SmartTransfer tenant (no hrms-* keys) hides the HR self-service screens", () => {
    const ids = itemIds({ enabledModules: ["workforce_core", "smarttransfer", "workflow"], roles: ["employee"] });
    expect(ids).not.toContain("myLeave");
    expect(ids).not.toContain("myPayslips");
  });

  it("fail-closed destinations hide on an empty roles claim; unknown roles keep the advisory show", () => {
    const revenue = NAV_GROUPS.find((g) => g.id === "revenue")!.items[0]!;
    const billing = NAV_GROUPS.find((g) => g.id === "billing")!.items[0]!;
    expect(isNavItemVisible(revenue, { roles: [] })).toBe(false);
    expect(isNavItemVisible(billing, { roles: [] })).toBe(false);
    expect(isNavItemVisible(revenue, {})).toBe(true);
    expect(isNavItemVisible(revenue, { roles: ["crm_user"] })).toBe(false);
  });

  it("every role-gated entry has a non-empty allow-list", () => {
    for (const i of NAV_GROUPS.flatMap((g) => g.items)) {
      if (i.rolesAllowed) expect(i.rolesAllowed.length, i.id).toBeGreaterThan(0);
    }
  });

  it("marks only the most specific entry as current", () => {
    const hrefs = ["/hr", "/hr/leave/apply", "/hr/leave/approvals", "/dashboard"];
    expect(activeNavHref("/hr/leave/apply", hrefs)).toBe("/hr/leave/apply");
    expect(activeNavHref("/hr/transfer", hrefs)).toBe("/hr");
    expect(activeNavHref("/hrx", hrefs)).toBeNull();
  });
});
