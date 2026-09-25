import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WorkforceWfhPageRedirect from "./page";

// /hr/workforce/wfh was an orphaned duplicate of /hr/wfh, and the actual
// "broken button": WFHRequestForm's redirectHref used to default here,
// which is role-gated away from a plain `employee` -- HRMS peripheral
// medium findings, item 1. Redirected rather than deleted, mirroring the
// /hr/appraisals -> /hr/apar precedent (PR #1571).
describe("WorkforceWfhPageRedirect", () => {
  it("redirects to the canonical /hr/wfh page", () => {
    WorkforceWfhPageRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/wfh");
  });
});
