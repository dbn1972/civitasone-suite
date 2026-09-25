import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WorkforceWorkSummaryPageRedirect from "./page";

// /hr/workforce/work-summary was an orphaned duplicate of
// /hr/work-summary (zero inbound links anywhere in the repo) -- HRMS
// peripheral medium findings, item 1. Redirected rather than deleted,
// mirroring the /hr/appraisals -> /hr/apar precedent (PR #1571).
describe("WorkforceWorkSummaryPageRedirect", () => {
  it("redirects to the canonical /hr/work-summary page", () => {
    WorkforceWorkSummaryPageRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/work-summary");
  });
});
