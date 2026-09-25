import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WorkforceOvertimePageRedirect from "./page";

// /hr/workforce/overtime was an orphaned duplicate of /hr/overtime (the
// canonical page, more recently maintained by PR #1554) -- HRMS peripheral
// medium findings, item 1. Redirected rather than deleted, mirroring the
// /hr/appraisals -> /hr/apar precedent (PR #1571).
describe("WorkforceOvertimePageRedirect", () => {
  it("redirects to the canonical /hr/overtime page", () => {
    WorkforceOvertimePageRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/overtime");
  });
});
