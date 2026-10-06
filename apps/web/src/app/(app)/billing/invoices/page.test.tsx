import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import BillingInvoicesPage from "./page";

// The page maps the raw loader rows through its own mapResponse (adding
// `reference`). The mock returns the already-mapped LoaderResult shape, so the
// tests pass rows WITH a `reference` field as the page's getInvoices would.
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    periodMonth: "2026-07",
    status: "issued",
    totalMinor: "500000",
    paidMinor: "0",
    outstandingMinor: "500000",
    currency: "INR",
    issuedAt: "2026-07-01T20:00:00.000Z",
    paidAt: null,
    cancelledAt: null,
    reference: "INV-2026-07-11111111",
    ...overrides,
  };
}

describe("BillingInvoicesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders a readable invoice reference and a formatted period (GAP-BILLING-INVOICES-02/05)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row()], source: "api" });
    const ui = await BillingInvoicesPage();
    render(ui);
    expect(screen.getByText("INV-2026-07-11111111")).toBeInTheDocument();
    // periodMonth "2026-07" -> "Jul 2026" via cellType "period"
    expect(screen.getByText("Jul 2026")).toBeInTheDocument();
  });

  it("renders a USD invoice with a $ symbol, not ₹ (GAP-BILLING-INVOICES-04)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [row({ currency: "USD", totalMinor: "123400" })],
      source: "api",
    });
    const ui = await BillingInvoicesPage();
    render(ui);
    expect(screen.getByText("$1,234.00")).toBeInTheDocument();
  });

  it("renders ₹ with Indian grouping for INR invoices (regression)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [row({ totalMinor: "12500000000" })],
      source: "api",
    });
    const ui = await BillingInvoicesPage();
    render(ui);
    // 12500000000 paise = ₹12,50,00,000.00 (lakh/crore grouping)
    expect(screen.getByText("₹12,50,00,000.00")).toBeInTheDocument();
  });

  it("renders the empty state only for a genuine source==='api' empty list", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await BillingInvoicesPage();
    render(ui);
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
  });

  it("GAP-BILLING-INVOICES-01: a failed fetch shows a retryable error state, never 'No invoices yet'", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error", status: 500 });
    const ui = await BillingInvoicesPage();
    render(ui);
    expect(screen.queryByText("No invoices yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    // RefreshErrorState exposes a retry affordance
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });

  it("GAP-BILLING-INVOICES-01: a 403 shows an access-restricted state, not a retry", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [],
      source: "error",
      status: 403,
      errorMessage: "requires one of: billing_admin, tenant_admin",
    });
    const ui = await BillingInvoicesPage();
    render(ui);
    expect(screen.queryByText("No invoices yet")).not.toBeInTheDocument();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });
});
