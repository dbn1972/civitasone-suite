import { describe, it, expect } from "vitest";
import { SALARY_ADMIN_ROLES as listRoles } from "./_salaryAdminRoles";
import { SALARY_ADMIN_ROLES as detailRoles } from "./[id]/_salaryAdminRoles";
import { SALARY_ADMIN_ROLES as slipsDetailRoles } from "../slips/[id]/_salaryAdminRoles";

/**
 * GAP-HR-SF09A-017 regression test.
 *
 * hr/payroll/salary-slips/page.tsx, salary-slips/[id]/page.tsx and
 * slips/[id]/page.tsx each independently declare their own
 * `SALARY_ADMIN_ROLES` array (this codebase's existing convention for a
 * role gate shared conceptually but not via a single import -- see e.g.
 * TRAINING_ADMIN_ROLES across training/feedback, training/new and
 * training/nominations). That duplication is exactly how these three
 * arrays silently diverged in the first place (payroll/pensioners/page.tsx's
 * sibling PENSIONER_VIEW_ROLES already had "finance_officer"; these three
 * did not) -- this test would have caught that divergence and now guards
 * against it recurring.
 *
 * Each array now lives in a small colocated `_salaryAdminRoles.ts` next to
 * its page.tsx (imported by the page), rather than being declared and
 * exported directly from page.tsx like TRAINING_ADMIN_ROLES is -- Next.js's
 * App Router build rejects any named export from a page.tsx other than its
 * own fixed set, and this regression test needs a real import of each copy.
 */
describe("salary-slip pages' SALARY_ADMIN_ROLES stay identical across all 3 files", () => {
  it("all three arrays contain the exact same roles", () => {
    const a = new Set(listRoles);
    const b = new Set(detailRoles);
    const c = new Set(slipsDetailRoles);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("includes finance_officer (matches the backend's payroll-service READER_ROLES and the sibling PENSIONER_VIEW_ROLES)", () => {
    for (const roles of [listRoles, detailRoles, slipsDetailRoles]) {
      expect(roles).toContain("finance_officer");
    }
  });
});
