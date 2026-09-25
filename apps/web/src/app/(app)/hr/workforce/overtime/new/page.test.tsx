import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import WorkforceOvertimeNewPageRedirect from "./page";

// /hr/workforce/overtime/new rendered OvertimeClaimForm, whose extra
// duty-officer/comp-mode fields are silently dropped by the backend (no
// matching column or schema field) -- a genuine duplicate of the canonical
// /hr/overtime/new form, not lost functionality. HRMS peripheral medium
// findings, item 1.
describe("WorkforceOvertimeNewPageRedirect", () => {
  it("redirects to the canonical /hr/overtime/new page", () => {
    WorkforceOvertimeNewPageRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/overtime/new");
  });
});
