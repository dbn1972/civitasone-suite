import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PaymentAdviceForm } from "./PaymentAdviceForm";

const VALID_BILL = "22222222-2222-2222-2222-222222222222";

// UX-017: PaymentAdviceForm (and the AdviceStatusLookup it renders) now read
// their copy through next-intl (useTranslations), so they need a real
// provider in the tree -- same pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PaymentAdviceForm />
    </NextIntlClientProvider>,
  );
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Bill ID/), { target: { value: VALID_BILL } });
  fireEvent.change(screen.getByLabelText(/Payee Name/), { target: { value: "Ramesh Kumar" } });
  fireEvent.change(screen.getByLabelText(/Payee Account No\./), { target: { value: "1234567890" } });
  fireEvent.change(screen.getByLabelText(/Payee IFSC/), { target: { value: "SBIN0001234" } });
  fireEvent.change(screen.getByLabelText(/Amount, in paise/), { target: { value: "500000" } });
  fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR01" } });
}

describe("PaymentAdviceForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires the core fields before opening the confirm dialog, with field-specific messages", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Generate Payment Advice" }));

    const billInput = screen.getByLabelText(/Bill ID/);
    expect(screen.getByText("Bill ID must be a valid UUID.")).toBeInTheDocument();
    expect(billInput).toHaveAttribute("aria-invalid", "true");
    expect(billInput).toHaveFocus();
    expect(screen.getByText("IFSC must be exactly 11 characters.")).toBeInTheDocument();
    expect(screen.queryByText(/Bill ID, payee name, account number/)).not.toBeInTheDocument();
  });

  it("generates a payment advice on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            adviceId: "adv-1", pfmsRef: "PFMS-ADV-1", billId: VALID_BILL, amountMinor: 500000,
            status: "submitted", submittedAt: "2026-08-01T00:00:00Z",
          },
        }),
        { status: 201 },
      ),
    );

    renderForm();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Generate Payment Advice" }));

    await waitFor(() => expect(screen.getByText("Generate this payment advice?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate advice"));

    await waitFor(() => {
      expect(screen.getByText(/Payment advice PFMS-ADV-1 generated/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderForm();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Generate Payment Advice" }));

    await waitFor(() => expect(screen.getByText("Generate this payment advice?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate advice"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  it("looks up a payment advice status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            adviceId: "adv-1", status: "processed", pfmsTransactionId: "PFMS-TXN-ADV1",
            processedAt: "2026-08-01T00:00:00Z", utrNumber: "UTR123",
          },
        }),
        { status: 200 },
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/Advice ID/), { target: { value: "adv-1" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText("UTR123")).toBeInTheDocument();
    });
  });
});
