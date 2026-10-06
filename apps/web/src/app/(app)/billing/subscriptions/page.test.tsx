import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import BillingSubscriptionsPage from "./page";

function sub(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-8888-7777-6666-555555555555",
    plan: "11111111-2222-3333-4444-555555555555",
    status: "active",
    currentPeriodStart: "2026-07-01",
    currentPeriodEnd: "2026-07-31",
    activeUsers: 12,
    currency: "INR",
    ...overrides,
  };
}

describe("BillingSubscriptionsPage (GAP-BILLING-SUBSCRIPTIONS-01..05)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders the single subscription with a status pill and dates (SUBS-02/03)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: sub(), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("01 Jul 2026")).toBeInTheDocument();
    expect(screen.getByText("31 Jul 2026")).toBeInTheDocument();
  });

  it("links the plan to its detail page (SUBS-03)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: sub(), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    const link = screen.getByRole("link", { name: "11111111-2222-3333-4444-555555555555" });
    expect(link).toHaveAttribute("href", "/billing/plans/11111111-2222-3333-4444-555555555555");
  });

  it("renders NO churn risk column/badge (SUBS-01/05 — dead data removed)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: sub(), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    expect(screen.queryByText(/churn/i)).not.toBeInTheDocument();
  });

  it("has a back link to /billing (SUBS-04)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: sub(), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    const back = screen.getByRole("link", { name: /back/i });
    expect(back).toHaveAttribute("href", "/billing");
  });

  it("a 200 + null shows the empty 'No subscription' state (SUBS-02)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    expect(screen.getByText("No subscription")).toBeInTheDocument();
  });

  it("a 500 shows a retryable error state, NOT 'No subscription' (SUBS-02)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 500 });
    render(await BillingSubscriptionsPage());
    expect(screen.queryByText("No subscription")).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });

  it("a 403 shows an access-restricted state (SUBS-02)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 403, errorMessage: "nope" });
    render(await BillingSubscriptionsPage());
    expect(screen.queryByText("No subscription")).not.toBeInTheDocument();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });
});
