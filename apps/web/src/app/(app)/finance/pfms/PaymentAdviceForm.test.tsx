import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PaymentAdviceForm } from "./PaymentAdviceForm";
import type { PfmsBill } from "./types";

const VALID_BILL = "22222222-2222-2222-2222-222222222222";

// UX-017: PaymentAdviceForm (and the AdviceStatusLookup it renders) now read
// their copy through next-intl (useTranslations), so they need a real
// provider in the tree -- same pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderForm(bills: PfmsBill[] = []) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PaymentAdviceForm bills={bills} />
    </NextIntlClientProvider>,
  );
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Bill ID/), { target: { value: VALID_BILL } });
  fireEvent.change(screen.getByLabelText(/Payee Name/), { target: { value: "Ramesh Kumar" } });
  fireEvent.change(screen.getByLabelText(/^Payee Account No\./), { target: { value: "1234567890" } });
  fireEvent.change(screen.getByLabelText(/Re-enter account number/), { target: { value: "1234567890" } });
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
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
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

  // GAP-FINANCE-PFMS-07: account entered twice; autofill off.
  it("blocks submit when the re-entered account number does not match", () => {
    renderForm();
    fillValidForm();
    fireEvent.change(screen.getByLabelText(/Re-enter account number/), { target: { value: "1234567891" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Payment Advice" }));
    expect(screen.getByText("Account numbers do not match.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Re-enter account number/)).toHaveFocus();
    expect(screen.queryByText("Generate this payment advice?")).not.toBeInTheDocument();
  });

  it("turns browser autofill off on the account number fields", () => {
    renderForm();
    expect(screen.getByLabelText(/^Payee Account No\./)).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText(/Re-enter account number/)).toHaveAttribute("autocomplete", "off");
  });

  it("offers a bill picker that fills bill id, payee name and amount without any UUID being typed", async () => {
    const bills: PfmsBill[] = [
      { id: VALID_BILL, billNo: "BILL-0042", vendor: "Acme Supplies", amountMinor: "1250000", status: "passed" },
      { id: "33333333-3333-3333-3333-333333333333", billNo: "BILL-0043", vendor: "Draft Co", amountMinor: "100", status: "pending" },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { adviceId: "a", pfmsRef: "R", billId: VALID_BILL, amountMinor: 1250000, status: "submitted", submittedAt: "x" } }), { status: 201 }),
    );
    renderForm(bills);

    expect(screen.queryByLabelText(/Bill ID/)).not.toBeInTheDocument();
    const select = screen.getByLabelText(/^Bill/) as HTMLSelectElement;
    // only payable (passed) bills are offered
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Select a bill…",
      "BILL-0042 — Acme Supplies — ₹12,500.00",
    ]);
    fireEvent.change(select, { target: { value: VALID_BILL } });
    // GAP-FINANCE-PFMS-07: the payee name comes from the bill's vendor, and says so, but stays editable;
    // the bank details are NOT on the bill and remain empty for the clerk to type.
    expect(screen.getByLabelText(/Payee Name/)).toHaveValue("Acme Supplies");
    expect(screen.getByText(/Filled from the bill's vendor/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Payee Account No\./)).toHaveValue("");
    expect(screen.getByLabelText(/Payee IFSC/)).toHaveValue("");
    expect(screen.getByLabelText(/Amount, in paise/)).toHaveValue("1250000");
    fireEvent.change(screen.getByLabelText(/Payee Name/), { target: { value: "Acme Supplies Pvt Ltd" } });
    expect(screen.queryByText(/Filled from the bill's vendor/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Payee Account No\./), { target: { value: "1234567890" } });
    fireEvent.change(screen.getByLabelText(/Re-enter account number/), { target: { value: "1234567890" } });
    fireEvent.change(screen.getByLabelText(/Payee IFSC/), { target: { value: "SBIN0001234" } });
    fireEvent.change(screen.getByLabelText(/Purpose Code/), { target: { value: "PUR01" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Payment Advice" }));
    await waitFor(() => expect(screen.getByText("Generate this payment advice?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate advice"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.billId).toBe(VALID_BILL);
    expect(body.amountMinor).toBe(1250000);
    // the edited name, not the vendor master name, is what is sent
    expect(body.payeeName).toBe("Acme Supplies Pvt Ltd");
  });

  // GAP-FINANCE-PFMS-07: prefill must never overwrite what the clerk typed, nor invent a name.
  describe("payee name prefill from the selected bill", () => {
    const BILL_A = VALID_BILL;
    const BILL_B = "44444444-4444-4444-4444-444444444444";
    const BILL_U = "55555555-5555-5555-5555-555555555555";
    const bills: PfmsBill[] = [
      { id: BILL_A, billNo: "BILL-A", vendor: "Acme Supplies", amountMinor: "1000", status: "passed" },
      { id: BILL_B, billNo: "BILL-B", vendor: "Beta Traders", amountMinor: "2000", status: "passed" },
      { id: BILL_U, billNo: "BILL-U", vendor: "Unknown vendor", amountMinor: "3000", status: "passed" },
    ];
    const pick = (id: string) => fireEvent.change(screen.getByLabelText(/^Bill/), { target: { value: id } });
    const payee = () => screen.getByLabelText(/Payee Name/) as HTMLInputElement;

    it("switching to another bill replaces a name the form filled in itself", () => {
      renderForm(bills);
      pick(BILL_A);
      expect(payee().value).toBe("Acme Supplies");
      pick(BILL_B);
      expect(payee().value).toBe("Beta Traders");
      expect(screen.getByLabelText(/Amount, in paise/)).toHaveValue("2000");
    });

    it("never overwrites a name the clerk typed", () => {
      renderForm(bills);
      pick(BILL_A);
      fireEvent.change(payee(), { target: { value: "Acme Supplies Pvt Ltd" } });
      pick(BILL_B);
      expect(payee().value).toBe("Acme Supplies Pvt Ltd");
    });

    it("fills nothing for a vendor the API could not name (Unknown vendor), and clears a name it had filled", () => {
      renderForm(bills);
      pick(BILL_U);
      expect(payee().value).toBe("");
      expect(screen.queryByText(/Filled from the bill's vendor/)).not.toBeInTheDocument();
      pick(BILL_A);
      expect(payee().value).toBe("Acme Supplies");
      pick(BILL_U);
      expect(payee().value).toBe("");
    });

    it("does not offer 'Unknown vendor' as if it were a vendor name in the picker", () => {
      renderForm(bills);
      const labels = Array.from((screen.getByLabelText(/^Bill/) as HTMLSelectElement).options).map((o) => o.textContent);
      expect(labels).toContain("BILL-U — ₹30.00");
      expect(labels.some((l) => /Unknown vendor/.test(l ?? ""))).toBe(false);
    });
  });

  it("requires a bill to be selected when the picker is shown", () => {
    renderForm([{ id: VALID_BILL, billNo: "BILL-0042", vendor: "Acme", amountMinor: "100", status: "passed" }]);
    fireEvent.click(screen.getByRole("button", { name: "Generate Payment Advice" }));
    expect(screen.getByText("Select a bill.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Bill/)).toHaveFocus();
  });

  it("never shows or uses the API's placeholder 'Vendor (xxxx)' as a name", () => {
    renderForm([{ id: VALID_BILL, billNo: "BILL-0099", vendor: "Vendor (a1b2)", amountMinor: "500", status: "passed" }]);
    const select = screen.getByLabelText(/^Bill$|^Bill \*/) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Select a bill…", "BILL-0099 — ₹5.00"]);
    fireEvent.change(select, { target: { value: VALID_BILL } });
    expect(screen.getByLabelText(/Payee Name/)).toHaveValue("");
  });

  it("searches the bills by number", () => {
    const mk = (n: string, id: string) => ({ id, billNo: n, vendor: "", amountMinor: "100", status: "passed" });
    renderForm([mk("BILL-0001", "a"), mk("BILL-0002", "b"), mk("BILL-0300", "c")]);
    const select = screen.getByLabelText(/^Bill \*/) as HTMLSelectElement;
    expect(select.options).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("Search bills"), { target: { value: "0300" } });
    expect(Array.from(select.options).map((o) => o.textContent?.split(" — ")[0])).toEqual(["Select a bill…", "BILL-0300"]);
  });
});
