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
    expect(screen.getByText("Amount must be a numeric paise value (digits only).")).toBeInTheDocument();
    expect(
      screen.queryByText(/Reference ID, beneficiary code, amount \(numeric paise\), and purpose code are required/),
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
    fireEvent.change(screen.getByLabelText(/Amount, in paise/), { target: { value: "150000" } });
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
    fireEvent.change(screen.getByLabelText(/Amount, in paise/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR02" } });
    fireEvent.click(screen.getByText("Submit Payment"));

    await waitFor(() => expect(screen.getByText("Submit this payment to PFMS?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit payment"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
