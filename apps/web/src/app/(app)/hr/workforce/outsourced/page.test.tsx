import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WorkforceOutsourcedPageRedirect from "./page";

// /hr/workforce/outsourced was an orphaned duplicate of /hr/outsourced
// (zero inbound links anywhere in the repo) -- HRMS peripheral medium
// findings, item 1. Redirected rather than deleted, mirroring the
// /hr/appraisals -> /hr/apar precedent (PR #1571).
describe("WorkforceOutsourcedPageRedirect", () => {
  it("redirects to the canonical /hr/outsourced page", () => {
    WorkforceOutsourcedPageRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/outsourced");
  });
});
