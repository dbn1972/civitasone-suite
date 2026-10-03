import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));

import LegacyStatutoryNpsRedirect from "./page";

describe("/hr/payroll/statutory/nps (GAP-PAYROLL-STATUTORY-NPS-01)", () => {
  it("redirects to the canonical /hr/payroll/nps page instead of rendering a duplicate ledger", () => {
    expect(() => LegacyStatutoryNpsRedirect()).toThrow("NEXT_REDIRECT:/hr/payroll/nps");
    expect(redirectMock).toHaveBeenCalledWith("/hr/payroll/nps");
  });
});
