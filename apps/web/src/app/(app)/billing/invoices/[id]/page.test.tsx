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
// GAP-BILLING-INVOICES-DETAIL-01/08: mock session role so we can control canIrn
// and verify the back-affordance removal.
const mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/roleGuard")>();
  return { ...orig, getSessionRoles: () => mockRoles };
});

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
    // Default: billing_admin so IRN buttons are visible in existing tests.
    mockRoles.splice(0, mockRoles.length, "billing_admin");
  });

  it("renders details, a humanized status and the empty e-invoice state on a 404 einvoice", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 }); // not generated yet

    const ui = await InvoiceDetailPage({ params: Promise.resolve({ id: "inv-1" }) });
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

    const ui = await InvoiceDetailPage({ params: Promise.resolve({ id: "inv-1" }) });
    render(ui);
    expect(screen.getByText("IRN12345")).toBeInTheDocument();
  });

  it("shows a not-found empty state for a 404 invoice", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 })
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 });

    const ui = await InvoiceDetailPage({ params: Promise.resolve({ id: "missing" }) });
    render(ui);
    expect(screen.getByText("This invoice may have been removed or the ID is invalid.")).toBeInTheDocument();
  });

  // GAP-BILLING-INVOICES-DETAIL-03: a transient outage must be a retryable error
  // state, NOT "Invoice not found".
  it("shows a retryable error state (not 'Invoice not found') on a 500 invoice fetch", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error", status: 500 })
      .mockResolvedValueOnce({ data: null, source: "error", status: 500 });

    const ui = await InvoiceDetailPage({ params: Promise.resolve({ id: "inv-1" }) });
    render(ui);
    expect(screen.queryByText("This invoice may have been removed or the ID is invalid.")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });

  // GAP-BILLING-INVOICES-DETAIL-04: a non-404 einvoice outage disables actions
  // and shows an unknown-status notice (not the empty "No e-invoice generated").
  it("surfaces 'GSTN status unknown' when the e-invoice fetch is a 503, with Generate disabled", async () => {
    mockRoles.splice(0, mockRoles.length, "billing_admin");
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error", status: 503 });

    const ui = await InvoiceDetailPage({ params: Promise.resolve({ id: "inv-1" }) });
    render(ui);
    expect(screen.queryByText("No e-invoice generated")).not.toBeInTheDocument();
    expect(screen.getByText(/GSTN status unknown/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate e-invoice (IRN) for invoice 11111111-2222-3333-4444-555555555555" }),
    ).toBeDisabled();
  });

  // GAP-BILLING-INVOICES-DETAIL-01: viewer role hides Generate/Cancel IRN.
  // Given: the signed-in user does not hold a billing role
  // When: the invoice detail page renders
  // Then: Generate and Cancel IRN buttons are NOT in the document
  it("hides Generate/Cancel IRN buttons for a non-billing role (DETAIL-01)", async () => {
    mockRoles.splice(0, mockRoles.length); // empty = viewer
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 });

    const ui = await InvoiceDetailPage({ params: Promise.resolve({ id: "inv-1" }) });
    render(ui);
    expect(
      screen.queryByRole("button", { name: /generate e-invoice/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel irn/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/requires a billing role/i)).toBeInTheDocument();
  });

  // GAP-BILLING-INVOICES-DETAIL-08: only one back affordance (AutoBreadcrumb);
  // PageHeader must NOT render a "Back" link alongside it.
  // Given: the invoice loads successfully
  // When: the detail page renders
  // Then: no "Back" link from PageHeader is present (breadcrumb is the only nav)
  it("renders no duplicate PageHeader back link alongside AutoBreadcrumb (DETAIL-08)", async () => {
    mockRoles.splice(0, mockRoles.length, "billing_admin");
    fetchJsonMock
      .mockResolvedValueOnce({ data: invoice, source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 });

    const ui = await InvoiceDetailPage({ params: Promise.resolve({ id: "inv-1" }) });
    render(ui);
    // PageHeader renders a link with text "Back" only when the back prop is set.
    // It must be absent now that we rely on AutoBreadcrumb.
    expect(screen.queryByRole("link", { name: "Back" })).not.toBeInTheDocument();
  });
});
