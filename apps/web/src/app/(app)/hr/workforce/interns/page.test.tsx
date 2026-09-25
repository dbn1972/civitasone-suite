import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WorkforceInternsPageRedirect from "./page";

// /hr/workforce/interns was an orphaned duplicate of /hr/interns (zero
// inbound links anywhere in the repo) -- HRMS peripheral medium findings,
// item 1. Redirected rather than deleted, mirroring the /hr/appraisals ->
// /hr/apar precedent (PR #1571).
describe("WorkforceInternsPageRedirect", () => {
  it("redirects to the canonical /hr/interns page", () => {
    WorkforceInternsPageRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/interns");
  });
});
