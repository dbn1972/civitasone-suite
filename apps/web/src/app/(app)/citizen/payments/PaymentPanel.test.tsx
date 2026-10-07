import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PaymentPanel, type PaymentSchedule } from "./PaymentPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const SCHEDULES: PaymentSchedule[] = [
  { id: "s1", name: "Birth certificate fee", baseAmount: "150000", currency: "INR" },
  { id: "s2", name: "Trade licence fee", baseAmount: "5000000", currency: "INR" },
];

function renderPanel(props: Partial<Parameters<typeof PaymentPanel>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PaymentPanel schedules={SCHEDULES} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("PaymentPanel", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GAP-CITIZEN-PAYMENTS-04: renders a retry state (not a disabled form) when the schedules fetch failed", () => {
    renderPanel({ loadFailed: true });
    // The old code rendered the form with a "No schedules" option; the fix
    // replaces it with RefreshErrorState (a Retry affordance), no form fields.
    expect(screen.queryByLabelText(enMessages.citizenPayments.scheduleLabel)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("GAP-CITIZEN-PAYMENTS-02: does NOT post on a single click — opens a confirmation with the amount preview, and cancel posts nothing", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(enMessages.citizenPayments.applicationIdLabel), {
      target: { value: "00000000-0000-4000-8000-000000000000" },
    });
    // Click the record button -> a dialog opens, no fetch yet.
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenPayments.recordAndIssue }));
    const dialog = await screen.findByRole("alertdialog");
    // GAP-CITIZEN-PAYMENTS-01: amount preview is ₹ formatted, not raw paise.
    expect(within(dialog).getByText(/₹1,500\.00/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    // Cancel -> still no network call.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("GAP-CITIZEN-PAYMENTS-01/06: confirming posts once and shows a ₹-formatted receipt line with a Print action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ receiptNo: "RCPT-1", amount: 150000, currency: "INR" }),
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText(enMessages.citizenPayments.applicationIdLabel), {
      target: { value: "00000000-0000-4000-8000-000000000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenPayments.recordAndIssue }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: enMessages.citizenPayments.confirmRecordCta }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Receipt RCPT-1 issued for ₹1,500\.00\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enMessages.citizenPayments.printReceipt })).toBeInTheDocument();
  });
});
