import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import InvoiceDetailPage from "./page";

const invoice = {
  id: "inv-1",
  periodMonth: "2026-07",
  status: "issued",
  totalMinor: "500000",
  paidMinor: "0",
  outstandingMinor: "500000",
  taxMinor: "50000",
  chargesMinor: "0",
  currency: "INR",
  issuedAt: "2026-07-01",
  paidAt: null,
  cancelledAt: null,
  cancelReason: null,
  issuedBy: "user-1",
  cancelledBy: null,
  items: [{ id: "item-1", description: "Platform fee", kind: "line", quantity: "1", amountMinor: "450000" }],
  approvals: [],
};

describe("InvoiceDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders invoice details and an empty e-invoice state when none was generated", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error" }); // 404 einvoice — normal, not shown as error

    const ui = await InvoiceDetailPage({ params: { id: "inv-1" } });
    render(ui);

    expect(screen.getByText("Platform fee")).toBeInTheDocument();
    expect(screen.getByText("No e-invoice generated")).toBeInTheDocument();
    expect(screen.queryByText("Showing saved information")).not.toBeInTheDocument();
  });

  it("renders e-invoice status when one exists", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({
        data: {
          id: "ei-1",
          invoiceId: "inv-1",
          irn: "IRN12345",
          ackNo: "ACK1",
          ackDate: "2026-07-02",
          signedQrCode: "qr-payload",
          status: "generated",
          errorMessage: null,
          cancelledAt: null,
          cancelReason: null,
          createdAt: "2026-07-02",
          updatedAt: "2026-07-02",
        },
        source: "api",
      });

    const ui = await InvoiceDetailPage({ params: { id: "inv-1" } });
    render(ui);

    expect(screen.getByText("IRN12345")).toBeInTheDocument();
  });

  it("shows a not-found empty state for a missing invoice", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error" });

    const ui = await InvoiceDetailPage({ params: { id: "missing" } });
    render(ui);

    expect(screen.getByText("This invoice may have been removed or the ID is invalid.")).toBeInTheDocument();
  });

  it("shows the data-source badge when the invoice loader itself falls back on error", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error" })
      .mockResolvedValueOnce({ data: null, source: "error" });

    const ui = await InvoiceDetailPage({ params: { id: "inv-1" } });
    render(ui);

    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
