import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { InvoiceActions } from "./InvoiceActions";
import type { EInvoiceStatus } from "./page";

function eInvoice(overrides: Partial<EInvoiceStatus> = {}): EInvoiceStatus {
  return {
    id: "ei-1",
    invoiceId: "inv-1",
    irn: "IRN12345",
    ackNo: "ACK1",
    ackDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago (in window)
    signedQrCode: "qr-payload",
    status: "generated",
    errorMessage: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("InvoiceActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows the no-e-invoice empty state and enables Generate when none exists", () => {
    render(<InvoiceActions invoiceId="inv-1" einvoice={null} />);
    expect(screen.getByText("No e-invoice generated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate e-invoice (IRN) for invoice inv-1" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" })).toBeDisabled();
  });

  it("generates an IRN on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "req-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<InvoiceActions invoiceId="inv-1" einvoice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate e-invoice (IRN) for invoice inv-1" }));

    await waitFor(() => expect(screen.getByText("Generate e-invoice (IRN)?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate IRN" }));

    await waitFor(() => {
      expect(screen.getByText(/E-invoice \(IRN\) generation submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe message when IRN generation fails (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INTEGRATION_DISABLED", message: "GSTN integration is not available" }), {
        status: 503,
      }),
    );

    render(<InvoiceActions invoiceId="inv-1" einvoice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate e-invoice (IRN) for invoice inv-1" }));
    await waitFor(() => expect(screen.getByText("Generate e-invoice (IRN)?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate IRN" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/INTEGRATION_DISABLED: GSTN integration is not available/)).not.toBeInTheDocument();
  });

  it("requires a reason before the Cancel IRN dialog can be confirmed (in-window)", async () => {
    render(<InvoiceActions invoiceId="inv-1" einvoice={eInvoice()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" }));

    await waitFor(() => expect(screen.getByText("Cancel this IRN?")).toBeInTheDocument());
    const confirmBtn = screen.getByRole("button", { name: "Cancel IRN" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for cancellation"), { target: { value: "Buyer GSTIN was wrong" } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("cancels an IRN on confirm with a reason (happy path, in-window)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "req-2", status: "accepted", correlationId: "c2" }), { status: 202 }),
    );

    render(<InvoiceActions invoiceId="inv-1" einvoice={eInvoice()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" }));
    await waitFor(() => expect(screen.getByText("Cancel this IRN?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for cancellation"), { target: { value: "Buyer GSTIN was wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel IRN" }));

    await waitFor(() => expect(screen.getByText(/IRN cancellation submitted/)).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  // GAP-BILLING-INVOICES-DETAIL-02: 24h NIC cancellation window.
  describe("IRN cancellation window (GAP-BILLING-INVOICES-DETAIL-02)", () => {
    it("disables Cancel and shows closed-window copy when ackDate is >24h old", () => {
      const old = eInvoice({ ackDate: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() });
      render(<InvoiceActions invoiceId="inv-1" einvoice={old} />);
      expect(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" })).toBeDisabled();
      expect(screen.getByText(/cancellation window closed/i)).toBeInTheDocument();
    });

    it("enables Cancel when ackDate is within 24h", () => {
      render(<InvoiceActions invoiceId="inv-1" einvoice={eInvoice()} />);
      expect(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" })).not.toBeDisabled();
      expect(screen.queryByText(/cancellation window closed/i)).not.toBeInTheDocument();
    });

    it("leaves Cancel enabled when ackDate is unknown (server decides)", () => {
      render(<InvoiceActions invoiceId="inv-1" einvoice={eInvoice({ ackDate: null })} />);
      expect(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" })).not.toBeDisabled();
    });
  });

  // GAP-BILLING-INVOICES-DETAIL-04: outage vs 404.
  describe("e-invoice status unknown (GAP-BILLING-INVOICES-DETAIL-04)", () => {
    it("disables both actions and shows an unknown-status notice with retry", () => {
      render(<InvoiceActions invoiceId="inv-1" einvoice={null} einvoiceUnknown />);
      expect(screen.queryByText("No e-invoice generated")).not.toBeInTheDocument();
      expect(screen.getByText(/GSTN status unknown/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Generate e-invoice (IRN) for invoice inv-1" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Retry status" })).toBeInTheDocument();
    });
  });

  // GAP-BILLING-INVOICES-DETAIL-05: pending polling + refresh.
  describe("pending IRN (GAP-BILLING-INVOICES-DETAIL-05)", () => {
    afterEach(() => vi.useRealTimers());

    it("shows an awaiting notice and a working Refresh button", () => {
      render(<InvoiceActions invoiceId="inv-1" einvoice={eInvoice({ status: "pending", irn: null })} />);
      expect(screen.getByText(/Awaiting GSTN response/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
      expect(refreshMock).toHaveBeenCalled();
    });

    it("polls router.refresh() while pending and stops once not pending", () => {
      vi.useFakeTimers();
      const { rerender } = render(<InvoiceActions invoiceId="inv-1" einvoice={eInvoice({ status: "pending", irn: null })} />);
      refreshMock.mockReset();
      act(() => { vi.advanceTimersByTime(8000); });
      expect(refreshMock).toHaveBeenCalledTimes(1);
      act(() => { vi.advanceTimersByTime(8000); });
      expect(refreshMock).toHaveBeenCalledTimes(2);
      // Status leaves pending -> polling stops.
      rerender(<InvoiceActions invoiceId="inv-1" einvoice={eInvoice({ status: "generated" })} />);
      refreshMock.mockReset();
      act(() => { vi.advanceTimersByTime(24000); });
      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  // GAP-BILLING-INVOICES-DETAIL-09: scannable QR, payload collapsed.
  describe("signed QR (GAP-BILLING-INVOICES-DETAIL-09)", () => {
    it("renders a scannable QR svg and hides the raw payload behind a disclosure", () => {
      const { container } = render(<InvoiceActions invoiceId="inv-1" einvoice={eInvoice()} />);
      const svg = container.querySelector('svg[aria-label="E-invoice signed QR code"]');
      expect(svg).toBeInTheDocument();
      // raw payload lives inside a collapsed <details>, not dumped inline
      expect(container.querySelector("details")).toBeInTheDocument();
      expect(screen.getByText("Show signed payload")).toBeInTheDocument();
    });
  });
});
