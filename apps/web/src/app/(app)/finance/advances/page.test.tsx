import { describe, it, expect, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import FinanceAdvancesRedirect from "./page";

// /finance/advances used to render a full page calling finance-service routes
// that 404. The user decided to redirect this dead cluster to the working
// hrms equivalent rather than delete it, so old links still land somewhere real.
describe("FinanceAdvancesRedirect", () => {
  it("redirects to the hrms advances page", () => {
    FinanceAdvancesRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/hr/advances");
  });
});
