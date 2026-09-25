import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WorkforceStaffingPlanPageRedirect from "./page";

// /hr/workforce/staffing-plan was an orphaned duplicate of
// /hr/staffing-plan (zero inbound links anywhere in the repo) -- HRMS
// peripheral medium findings, item 1. Redirected rather than deleted,
// mirroring the /hr/appraisals -> /hr/apar precedent (PR #1571).
describe("WorkforceStaffingPlanPageRedirect", () => {
  it("redirects to the canonical /hr/staffing-plan page", () => {
    WorkforceStaffingPlanPageRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/staffing-plan");
  });
});
