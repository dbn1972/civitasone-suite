import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const formProps = vi.fn();
vi.mock("./NewExpenseClaimForm", () => ({
  NewExpenseClaimForm: (props: Record<string, unknown>) => {
    formProps(props);
    return null;
  },
}));
vi.mock("./ExpensesView", () => ({ ExpensesView: () => null }));
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: async () => ({ data: [], source: "api" }),
}));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["employee"] }));

import ExpensesPage from "./page";

const TRAVEL_ID = "11111111-2222-4333-8444-555555555555";

describe("ExpensesPage travel-request link (GAP-HR-TRAVEL-02)", () => {
  beforeEach(() => formProps.mockReset());

  it("passes a valid ?travelRequestId to the claim form", async () => {
    render(await ExpensesPage({ searchParams: { travelRequestId: TRAVEL_ID } }));
    expect(formProps).toHaveBeenCalledWith({ travelRequestId: TRAVEL_ID });
  });

  it("drops a malformed ?travelRequestId rather than forwarding it", async () => {
    render(await ExpensesPage({ searchParams: { travelRequestId: "<script>x</script>" } }));
    expect(formProps).toHaveBeenCalledWith({});
  });

  it("renders without any search params", async () => {
    render(await ExpensesPage({}));
    expect(formProps).toHaveBeenCalledWith({});
  });
});
