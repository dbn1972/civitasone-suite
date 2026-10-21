import { describe, it, expect, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";

import OrgHierarchyRedirect from "./page";

// GAP-TENANT-ORG-HIERARCHY-01: the flat /tenant/org-hierarchy table was replaced
// by a redirect to the working tree view under /tenant-admin. The global
// vitest.setup.ts stubs next/navigation redirect as a no-op vi.fn, so the
// assertion is on the redirect target.
describe("tenant/org-hierarchy redirect (GAP-TENANT-ORG-HIERARCHY-01)", () => {
  beforeEach(() => vi.mocked(redirect).mockClear());

  it("redirects to the tenant-admin org hierarchy tree view", () => {
    OrgHierarchyRedirect();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/tenant-admin/org-hierarchy");
  });
});
