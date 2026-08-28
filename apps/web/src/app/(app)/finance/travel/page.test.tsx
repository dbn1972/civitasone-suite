import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import FinanceTravelRedirect from "./page";

// /finance/travel used to render a full page calling finance-service routes
// that 404. The user decided to redirect this dead cluster to the working
// hrms equivalent rather than delete it, so old links still land somewhere real.
describe("FinanceTravelRedirect", () => {
  it("redirects to the hrms travel page", () => {
    FinanceTravelRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/travel");
  });
});
