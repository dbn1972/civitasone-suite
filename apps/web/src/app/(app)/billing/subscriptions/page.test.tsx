import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

const fetchJsonMock = vi.fn();

const HIST_ACTIVE = { id: "aaaaaaaa-1111-2222-3333-444444444444", plan: "p-1", planName: "Standard", status: "active", startDate: "2026-04-01", renewalDate: "2027-03-31", amountMinor: "499900", currency: "INR" };
const HIST_PAST = { id: "bbbbbbbb-1111-2222-3333-444444444444", plan: "p-0", planName: "Basic", status: "cancelled", startDate: "2025-04-01", renewalDate: "2026-03-31", amountMinor: "99900", currency: "INR" };

// Route the two loaders by URL: the current subscription and the history list.
function mockApi(subResult: unknown, historyResult: unknown = { data: { data: [] }, source: "api", status: 200 }) {
  fetchJsonMock.mockImplementation(async (url: string, _f: unknown, opts?: { mapResponse?: (p: unknown) => unknown }) => {
    if (String(url).endsWith("/history")) {
      const h = historyResult as { data: unknown; source: string; status: number };
      return { ...h, data: h.source === "error" ? null : opts?.mapResponse?.(h.data) };
    }
    return subResult;
  });
}
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
    mockApi({ data: sub(), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("01 Jul 2026")).toBeInTheDocument();
    expect(screen.getByText("31 Jul 2026")).toBeInTheDocument();
  });

  it("links the plan to its detail page (SUBS-03)", async () => {
    mockApi({ data: sub(), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    const link = screen.getByRole("link", { name: "11111111-2222-3333-4444-555555555555" });
    expect(link).toHaveAttribute("href", "/billing/plans/11111111-2222-3333-4444-555555555555");
  });

  it("SUBS-03 (UAT B4): shows the plan name as the link text, start, renewal and the plan price", async () => {
    mockApi({ data: sub({ planName: "Standard", startDate: "2026-04-01", renewalDate: "2027-03-31", amountMinor: "499900" }), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    expect(screen.getByRole("link", { name: "Standard" })).toHaveAttribute("href", "/billing/plans/11111111-2222-3333-4444-555555555555");
    expect(screen.getByText("01 Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("31 Mar 2027")).toBeInTheDocument();
    expect(screen.getByText("₹4,999.00")).toBeInTheDocument();
  });

  it("renders NO churn risk column/badge (SUBS-01/05 — dead data removed)", async () => {
    mockApi({ data: sub(), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    expect(screen.queryByText(/churn/i)).not.toBeInTheDocument();
  });

  it("has a back link to /billing (SUBS-04)", async () => {
    mockApi({ data: sub(), source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    const back = screen.getByRole("link", { name: /back/i });
    expect(back).toHaveAttribute("href", "/billing");
  });

  it("a 200 + null shows the empty 'No subscription' state (SUBS-02)", async () => {
    mockApi({ data: null, source: "api", status: 200 });
    render(await BillingSubscriptionsPage());
    expect(screen.getByText("No subscription")).toBeInTheDocument();
  });

  it("a 500 shows a retryable error state, NOT 'No subscription' (SUBS-02)", async () => {
    mockApi({ data: null, source: "error", status: 500 });
    render(await BillingSubscriptionsPage());
    expect(screen.queryByText("No subscription")).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });

  it("a 403 shows an access-restricted state (SUBS-02)", async () => {
    mockApi({ data: null, source: "error", status: 403, errorMessage: "nope" });
    render(await BillingSubscriptionsPage());
    expect(screen.queryByText("No subscription")).not.toBeInTheDocument();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });

  describe("subscription history table (SUBS-03, review r1)", () => {
    const okSub = { data: sub(), source: "api", status: 200 };
    const withRows = { data: { data: [HIST_ACTIVE, HIST_PAST] }, source: "api", status: 200 };

    it("renders the history rows with plan link, status, dates and price", async () => {
      mockApi(okSub, withRows);
      render(await BillingSubscriptionsPage());
      const table = screen.getByRole("table");
      expect(within(table).getByRole("link", { name: "Standard" })).toHaveAttribute("href", "/billing/plans/p-1");
      expect(within(table).getByRole("link", { name: "Basic" })).toHaveAttribute("href", "/billing/plans/p-0");
      expect(within(table).getByText("₹4,999.00")).toBeInTheDocument();
    });

    it("the Active / Past / All filter narrows the rows", async () => {
      mockApi(okSub, withRows);
      render(await BillingSubscriptionsPage());
      const table = () => screen.getByRole("table");
      expect(within(table()).getByText("Standard")).toBeInTheDocument();
      expect(within(table()).getByText("Basic")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "Past" }));
      expect(within(table()).queryByText("Standard")).not.toBeInTheDocument();
      expect(within(table()).getByText("Basic")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "Active" }));
      expect(within(table()).getByText("Standard")).toBeInTheDocument();
      expect(within(table()).queryByText("Basic")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "All" }));
      expect(within(table()).getByText("Basic")).toBeInTheDocument();
    });

    it("a failed history load shows an error state, not an empty table", async () => {
      mockApi(okSub, { data: null, source: "error", status: 500 });
      render(await BillingSubscriptionsPage());
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
    });

    it("an empty history shows the guided empty state", async () => {
      mockApi(okSub, { data: { data: [] }, source: "api", status: 200 });
      render(await BillingSubscriptionsPage());
      expect(screen.getByText("No subscriptions yet")).toBeInTheDocument();
    });
  });
});
