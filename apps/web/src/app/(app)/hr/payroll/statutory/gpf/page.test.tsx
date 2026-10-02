import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));

import LegacyStatutoryGpfRedirect from "./page";

describe("/hr/payroll/statutory/gpf (GAP-PAYROLL-STATUTORY-GPF-01)", () => {
  it("redirects to the canonical /hr/payroll/gpf page instead of rendering a duplicate ledger", () => {
    expect(() => LegacyStatutoryGpfRedirect()).toThrow("NEXT_REDIRECT:/hr/payroll/gpf");
    expect(redirectMock).toHaveBeenCalledWith("/hr/payroll/gpf");
  });
});
