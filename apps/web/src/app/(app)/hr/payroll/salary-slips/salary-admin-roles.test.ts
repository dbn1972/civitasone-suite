import { describe, it, expect } from "vitest";
import { SALARY_ADMIN_ROLES as listRoles } from "./page";
import { SALARY_ADMIN_ROLES as detailRoles } from "./[id]/page";
import { SALARY_ADMIN_ROLES as slipsDetailRoles } from "../slips/[id]/page";

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
