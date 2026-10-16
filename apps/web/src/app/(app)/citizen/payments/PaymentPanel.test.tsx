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

  /** Simulate resolving a tracking number → applicationId so the payment form becomes submittable. */
  async function resolveTracking(trackingNo = "TRK-2026-0001", appId = "00000000-0000-4000-8000-000000000000") {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ applicationId: appId, trackingNo, status: "submitted", channel: "web", acknowledgedAt: "" }),
    });
    fireEvent.change(screen.getByLabelText(enMessages.citizenPayments.trackingNoLabel), {
      target: { value: trackingNo },
    });
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenPayments.resolveTracking }));
    // Wait for the resolved confirmation text
    await screen.findByRole("status");
  }

  it("GAP-CITIZEN-PAYMENTS-04: renders a retry state (not a disabled form) when the schedules fetch failed", () => {
    renderPanel({ loadFailed: true });
    // The old code rendered the form with a "No schedules" option; the fix
    // replaces it with RefreshErrorState (a Retry affordance), no form fields.
    expect(screen.queryByLabelText(enMessages.citizenPayments.scheduleLabel)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("GAP-CITIZEN-PAYMENTS-02: does NOT post on a single click — opens a confirmation with the amount preview, and cancel posts nothing", async () => {
    renderPanel();
    await resolveTracking();
    // Click the record button -> a dialog opens, no fetch yet (resolve already consumed its mock).
    vi.clearAllMocks();
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
    renderPanel();
    // Step 1: resolve a tracking number.
    await resolveTracking();
    // Step 2: reset call count, then mock the payment POST.
    vi.clearAllMocks();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ receiptNo: "RCPT-1", amount: 150000, currency: "INR" }),
    });
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenPayments.recordAndIssue }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: enMessages.citizenPayments.confirmRecordCta }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Receipt RCPT-1 issued for ₹1,500\.00\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enMessages.citizenPayments.printReceipt })).toBeInTheDocument();
  });

  // Given: the clerk enters a tracking number and clicks Find Application
  // When: the intake track API returns an applicationId
  // Then: the applicationId is shown as read-only; the payment form becomes submittable
  //       (GAP-CITIZEN-PAYMENTS-06)
  it("GAP-CITIZEN-PAYMENTS-06: resolves tracking number to applicationId and enables the payment form", async () => {
    renderPanel();
    // Before resolve: Record button is disabled (no applicationId)
    expect(screen.getByRole("button", { name: enMessages.citizenPayments.recordAndIssue })).toBeDisabled();
    await resolveTracking("TRK-2026-0042", "app-uuid-9999");
    // After resolve: applicationId shown, button enabled
    expect(await screen.findByRole("status")).toHaveTextContent("app-uuid-9999");
    expect(screen.getByRole("button", { name: enMessages.citizenPayments.recordAndIssue })).not.toBeDisabled();
  });

  // Given: the tracking number lookup fails (404)
  // When: the clerk clicks Find Application
  // Then: a friendly error is shown; applicationId stays empty; form stays disabled
  it("GAP-CITIZEN-PAYMENTS-06: shows a friendly error when tracking number lookup fails", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: "NOT_FOUND" }),
      clone: () => ({ json: async () => ({ code: "NOT_FOUND" }) }),
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText(enMessages.citizenPayments.trackingNoLabel), {
      target: { value: "TRK-NOTEXIST" },
    });
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenPayments.resolveTracking }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enMessages.citizenPayments.recordAndIssue })).toBeDisabled();
  });
});
