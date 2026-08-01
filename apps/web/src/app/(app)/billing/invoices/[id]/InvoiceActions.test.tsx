import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { InvoiceActions } from "./InvoiceActions";
import type { EInvoiceStatus } from "./page";

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

  it("surfaces a server error when IRN generation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INTEGRATION_DISABLED", message: "GSTN integration is not available" }), {
        status: 503,
      }),
    );

    render(<InvoiceActions invoiceId="inv-1" einvoice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate e-invoice (IRN) for invoice inv-1" }));

    await waitFor(() => expect(screen.getByText("Generate e-invoice (IRN)?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate IRN" }));

    await waitFor(() => {
      expect(screen.getByText(/INTEGRATION_DISABLED: GSTN integration is not available/)).toBeInTheDocument();
    });
  });

  const generatedEInvoice: EInvoiceStatus = {
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
  };

  it("requires a reason before the Cancel IRN dialog can be confirmed", async () => {
    render(<InvoiceActions invoiceId="inv-1" einvoice={generatedEInvoice} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" }));

    await waitFor(() => expect(screen.getByText("Cancel this IRN?")).toBeInTheDocument());
    const confirmBtn = screen.getByRole("button", { name: "Cancel IRN" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for cancellation"), { target: { value: "Buyer GSTIN was wrong" } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("cancels an IRN on confirm with a reason (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "req-2", status: "accepted", correlationId: "c2" }), { status: 202 }),
    );

    render(<InvoiceActions invoiceId="inv-1" einvoice={generatedEInvoice} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel IRN for invoice inv-1" }));

    await waitFor(() => expect(screen.getByText("Cancel this IRN?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for cancellation"), { target: { value: "Buyer GSTIN was wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel IRN" }));

    await waitFor(() => {
      expect(screen.getByText(/IRN cancellation submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });
});
