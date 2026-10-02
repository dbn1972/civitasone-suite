import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { SubmitPaymentForm } from "./SubmitPaymentForm";

// UX-017: SubmitPaymentForm now reads its copy through next-intl
// (useTranslations), so it needs a real provider in the tree -- same
// pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SubmitPaymentForm />
    </NextIntlClientProvider>,
  );
}

describe("SubmitPaymentForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires the core fields before opening the confirm dialog, with field-specific messages", () => {
    renderForm();
    fireEvent.click(screen.getByText("Submit Payment"));

    const refInput = screen.getByLabelText(/Reference ID/);
    expect(screen.getByText("Reference ID is required.")).toBeInTheDocument();
    expect(refInput).toHaveAttribute("aria-invalid", "true");
    expect(refInput).toHaveAttribute("aria-describedby", screen.getByText("Reference ID is required.").id);
    expect(refInput).toHaveFocus();

    // Amount gets its own, field-specific message — not the generic combined text.
    expect(screen.getByText("Enter the amount in rupees with at most 2 decimals, e.g. 15,000.00.")).toBeInTheDocument();
    expect(
      screen.queryByText(/Reference ID, beneficiary code, amount \(rupees\), and purpose code are required/),
    ).not.toBeInTheDocument();
  });

  it("submits a payment on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { referenceId: "REF-1", pfmsTransactionId: "TXN-1", status: "accepted", timestamp: "2026-08-01T00:00:00Z" },
        }),
        { status: 201 },
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/Reference ID/), { target: { value: "REF-1" } });
    fireEvent.change(screen.getByLabelText(/Beneficiary Code/), { target: { value: "BEN-1" } });
    fireEvent.change(screen.getByLabelText(/Amount \(₹\)/), { target: { value: "1,500" } });
    fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR01" } });
    fireEvent.click(screen.getByText("Submit Payment"));

    await waitFor(() => expect(screen.getByText("Submit this payment to PFMS?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit payment"));

    await waitFor(() => {
      expect(screen.getByText(/Payment REF-1 submitted to PFMS/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/Reference ID/), { target: { value: "REF-2" } });
    fireEvent.change(screen.getByLabelText(/Beneficiary Code/), { target: { value: "BEN-2" } });
    fireEvent.change(screen.getByLabelText(/Amount \(₹\)/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR02" } });
    fireEvent.click(screen.getByText("Submit Payment"));

    await waitFor(() => expect(screen.getByText("Submit this payment to PFMS?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit payment"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-PFMS-02
  it("shows a live rupee preview and restates the amount in the confirm dialog; posts PAISE", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { referenceId: "REF-9", pfmsTransactionId: "T", status: "accepted", timestamp: "2026-08-01T00:00:00Z" } }),
        { status: 201 },
      ),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText(/Reference ID/), { target: { value: "REF-9" } });
    fireEvent.change(screen.getByLabelText(/Beneficiary Code/), { target: { value: "BEN-9" } });
    fireEvent.change(screen.getByLabelText(/Amount \(₹\)/), { target: { value: "15,000" } });
    fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR09" } });
    expect(screen.getByText("₹15,000.00")).toBeInTheDocument(); // live preview under the field
    fireEvent.click(screen.getByText("Submit Payment"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹15,000.00");
    fireEvent.click(screen.getByText("Submit payment"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.amount).toBe("1500000");
  });

  it("rejects a sub-paise rupee amount instead of rounding it", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Reference ID/), { target: { value: "R" } });
    fireEvent.change(screen.getByLabelText(/Beneficiary Code/), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText(/Amount \(₹\)/), { target: { value: "12.345" } });
    fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "P" } });
    fireEvent.click(screen.getByText("Submit Payment"));
    expect(screen.getByText(/at most 2 decimals/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
