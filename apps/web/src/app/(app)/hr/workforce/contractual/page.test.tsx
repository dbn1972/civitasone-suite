import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WorkforceContractualPageRedirect from "./page";

// /hr/workforce/contractual was an orphaned duplicate of /hr/contractual
// (zero inbound links anywhere in the repo) -- HRMS peripheral medium
// findings, item 1. Redirected rather than deleted, mirroring the
// /hr/appraisals -> /hr/apar precedent (PR #1571).
describe("WorkforceContractualPageRedirect", () => {
  it("redirects to the canonical /hr/contractual page", () => {
    WorkforceContractualPageRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/contractual");
  });
});
