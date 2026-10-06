import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/billing/invoices/inv-1",
}));

import InvoiceDetailPage from "./page";

const invoice = {
  id: "11111111-2222-3333-4444-555555555555",
  periodMonth: "2026-07",
  status: "issued",
  totalMinor: "500000",
  paidMinor: "0",
  outstandingMinor: "500000",
  taxMinor: "50000",
  chargesMinor: "0",
  currency: "INR",
  issuedAt: "2026-07-01T20:00:00.000Z",
  paidAt: null,
  cancelledAt: null,
  cancelReason: null,
  issuedBy: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  cancelledBy: null,
  items: [{ id: "item-1", description: "Platform fee", kind: "line", quantity: "1", amountMinor: "450000" }],
  approvals: [],
};

describe("InvoiceDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders details, a humanized status and the empty e-invoice state on a 404 einvoice", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 }); // not generated yet

    const ui = await InvoiceDetailPage({ params: { id: "inv-1" } });
    render(ui);

    expect(screen.getByText("Platform fee")).toBeInTheDocument();
    expect(screen.getByText("No e-invoice generated")).toBeInTheDocument();
    // GAP-BILLING-INVOICES-DETAIL-07: status humanized, not raw lowercase "issued"
    expect(screen.getAllByText("Issued").length).toBeGreaterThan(0);
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("renders e-invoice status when one exists", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({
        data: {
          id: "ei-1", invoiceId: "inv-1", irn: "IRN12345", ackNo: "ACK1",
          ackDate: new Date().toISOString(), signedQrCode: "qr-payload", status: "generated",
          errorMessage: null, cancelledAt: null, cancelReason: null,
          createdAt: "2026-07-02", updatedAt: "2026-07-02",
        },
        source: "api",
      });

    const ui = await InvoiceDetailPage({ params: { id: "inv-1" } });
    render(ui);
    expect(screen.getByText("IRN12345")).toBeInTheDocument();
  });

  it("shows a not-found empty state for a 404 invoice", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 })
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 });

    const ui = await InvoiceDetailPage({ params: { id: "missing" } });
    render(ui);
    expect(screen.getByText("This invoice may have been removed or the ID is invalid.")).toBeInTheDocument();
  });

  // GAP-BILLING-INVOICES-DETAIL-03: a transient outage must be a retryable error
  // state, NOT "Invoice not found".
  it("shows a retryable error state (not 'Invoice not found') on a 500 invoice fetch", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error", status: 500 })
      .mockResolvedValueOnce({ data: null, source: "error", status: 500 });

    const ui = await InvoiceDetailPage({ params: { id: "inv-1" } });
    render(ui);
    expect(screen.queryByText("This invoice may have been removed or the ID is invalid.")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });

  // GAP-BILLING-INVOICES-DETAIL-04: a non-404 einvoice outage disables actions
  // and shows an unknown-status notice (not the empty "No e-invoice generated").
  it("surfaces 'GSTN status unknown' when the e-invoice fetch is a 503, with Generate disabled", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error", status: 503 });

    const ui = await InvoiceDetailPage({ params: { id: "inv-1" } });
    render(ui);
    expect(screen.queryByText("No e-invoice generated")).not.toBeInTheDocument();
    expect(screen.getByText(/GSTN status unknown/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate e-invoice (IRN) for invoice 11111111-2222-3333-4444-555555555555" }),
    ).toBeDisabled();
  });
});
