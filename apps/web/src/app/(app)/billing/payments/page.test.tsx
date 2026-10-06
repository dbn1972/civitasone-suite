import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import BillingPaymentsPage, { type PaymentRow } from "./page";

// The mock returns the LoaderResult shape the page's getPayments would produce
// AFTER its mapResponse runs, so these rows already carry displayRef.
function row(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    invoiceId: "11111111-2222-3333-4444-555555555555",
    amountMinor: "4999900",
    currency: "INR",
    method: "upi",
    status: "captured",
    receiptNo: "RCPT-2026-001",
    reference: "pay_abc123",
    receivedAt: "2026-07-01T06:30:00.000Z",
    displayRef: "RCPT-2026-001",
    ...overrides,
  };
}

describe("BillingPaymentsPage (GAP-BILLING-PAYMENTS-01/02/03/04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("shows amount in ₹ with Indian grouping, the mode, and the paid date", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row()], source: "api" });
    const ui = await BillingPaymentsPage();
    render(ui);
    // 4999900 paise = ₹49,999.00
    expect(screen.getByText("₹49,999.00")).toBeInTheDocument();
    expect(screen.getByText("upi")).toBeInTheDocument();
    // receivedAt rendered via cellType "date" (dd Mon yyyy, IST)
    expect(screen.getByText("01 Jul 2026")).toBeInTheDocument();
    expect(screen.getByText("RCPT-2026-001")).toBeInTheDocument();
  });

  it("renders no raw 8-char uuid prefix and never prints the reference twice (PAYMENTS-03)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row()], source: "api" });
    const ui = await BillingPaymentsPage();
    const { container } = render(ui);
    // The receipt reference appears exactly once (one cell), not duplicated as Meta.
    expect(screen.getAllByText("RCPT-2026-001")).toHaveLength(1);
    // No raw uuid prefix cell.
    expect(container.textContent).not.toContain("aaaaaaaa");
  });

  it("links the whole row to the settled invoice (PAYMENTS-01)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row()], source: "api" });
    const ui = await BillingPaymentsPage();
    render(ui);
    const link = screen.getByRole("link", { name: /open rcpt-2026-001/i });
    expect(link).toHaveAttribute("href", "/billing/invoices/11111111-2222-3333-4444-555555555555");
  });

  it("USD payment shows a $ amount, not ₹ (money formatter honours currency)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [row({ currency: "USD", amountMinor: "123400", displayRef: "RCPT-X" })],
      source: "api",
    });
    const ui = await BillingPaymentsPage();
    render(ui);
    expect(screen.getByText("$1,234.00")).toBeInTheDocument();
  });

  it("a 500 shows a retryable error state, never 'No payments yet' (PAYMENTS-01)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error", status: 500 });
    const ui = await BillingPaymentsPage();
    render(ui);
    expect(screen.queryByText("No payments yet")).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });

  it("a 403 shows an access-restricted state, not a retry (PAYMENTS-01)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [],
      source: "error",
      status: 403,
      errorMessage: "requires one of: billing_admin, tenant_admin",
    });
    const ui = await BillingPaymentsPage();
    render(ui);
    expect(screen.queryByText("No payments yet")).not.toBeInTheDocument();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });

  it("shows the empty state only for a genuine source==='api' empty list", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await BillingPaymentsPage();
    render(ui);
    expect(screen.getByText("No payments yet")).toBeInTheDocument();
  });
});
