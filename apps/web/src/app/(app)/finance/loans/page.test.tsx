import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import FinanceLoansRedirect from "./page";

// /finance/loans used to render a full page calling finance-service routes
// that 404. The user decided to redirect this dead cluster to the working
// hrms equivalent rather than delete it, so old links still land somewhere real.
describe("FinanceLoansRedirect", () => {
  it("redirects to the hrms loans page", () => {
    FinanceLoansRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/loans");
  });
});
