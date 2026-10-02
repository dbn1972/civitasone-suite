import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));

import TreasuryPfmsRedirect from "./page";

// GAP-FINANCE-PFMS-08: one PFMS route; the old URL redirects.
describe("/finance/treasury/pfms", () => {
  it("redirects to /finance/pfms", () => {
    expect(() => TreasuryPfmsRedirect()).toThrow("NEXT_REDIRECT:/finance/pfms");
    expect(redirectMock).toHaveBeenCalledWith("/finance/pfms");
  });
});
