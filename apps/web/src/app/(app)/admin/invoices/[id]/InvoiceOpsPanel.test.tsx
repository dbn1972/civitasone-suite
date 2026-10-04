import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { InvoiceOpsPanel, type InvoiceOpsData } from "./InvoiceOpsPanel";
import type { AdminInvoiceDetail } from "@/app/_data/loaders";
import type { OfflinePaymentView } from "@/lib/admin/invoiceOps";

const invoice: AdminInvoiceDetail = {
  id: "5e8c1000-0000-4000-8000-000000000001", periodMonth: "2026-09", status: "issued", currency: "INR",
  totalMinor: "250050", taxMinor: "0", chargesMinor: "0", paidMinor: "0", outstandingMinor: "250050",
  issuedAt: "2026-09-01T00:00:00.000Z", paidAt: null, cancelledAt: null, cancelReason: null, items: [], approvals: [],
};
const row = (over: Partial<OfflinePaymentView> = {}): OfflinePaymentView => ({
  id: "r1", mode: "neft", reference: "SBIN523345678901", paidOn: "2026-09-20", amountMinor: "250050", reason: "NEFT received", status: "pending",
  decisionReason: null, autoApproved: false, requestedByMe: false, canDecide: true, createdAt: "2026-09-21T00:00:00.000Z", decidedAt: null, ...over,
});
const settingsOn = { offlineMakerChecker: true, reminderOverdueDays: null, pendingMakerCheckerRequest: null };
const data = (over: Partial<InvoiceOpsData> = {}): InvoiceOpsData => ({ payments: [], reminders: { lastSentAt: null, nextAllowedAt: null, count: 0 }, settings: settingsOn, canOperate: true, ...over });
const ui = (initial: InvoiceOpsData, inv = invoice, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}><InvoiceOpsPanel invoice={inv} initial={initial} /></NextIntlClientProvider>
);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const posts = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST");
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

// GAP-ADMIN-INVOICES-06
describe("InvoiceOpsPanel: offline payment", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { vi.restoreAllMocks(); fetchSpy = vi.fn(async () => json({ data: [] }, 202)); vi.stubGlobal("fetch", fetchSpy); });

  it("empty and failed reads are different screens", () => {
    const { unmount } = render(ui(data()));
    expect(screen.getByText("No offline payments recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record offline payment" })).toBeInTheDocument();
    unmount();
    render(ui(data({ payments: null })));
    expect(screen.queryByText("No offline payments recorded")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });

  it("the record dialog validates before any request, fixes the amount to the outstanding paise, and submits for approval", async () => {
    render(ui(data()));
    fireEvent.click(screen.getByRole("button", { name: "Record offline payment" }));
    expect(screen.getByTestId("record-amount")).toHaveTextContent("₹2,500.50");
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(await screen.findByText(/A NEFT UTR is 16 characters/)).toBeInTheDocument();
    expect(screen.getByText(/at least 3 characters/)).toBeInTheDocument();
    expect(posts(fetchSpy)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Bank UTR \/ instrument number/), { target: { value: " sbin523345678901 " } });
    fireEvent.change(screen.getByLabelText(/^Paid on/), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText(/Reason \/ note/), { target: { value: "NEFT received in the treasury" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => expect(posts(fetchSpy)).toHaveLength(1));
    expect(String(posts(fetchSpy)[0]![0])).toBe(`/api/proxy/v1/billing/invoices/${invoice.id}/offline-payments`);
    expect(body(posts(fetchSpy)[0]!)).toEqual({ mode: "neft", reference: "sbin523345678901", paidOn: "2026-09-20", amountMinor: "250050", reason: "NEFT received in the treasury" });
    expect(await screen.findByText(/waiting for a second administrator/)).toBeInTheDocument();
  });

  it("a duplicate UTR comes back as a plain-language message in the dialog", async () => {
    fetchSpy.mockImplementation(async () => json({ code: "DUPLICATE_REFERENCE", message: "internal" }, 409));
    render(ui(data()));
    fireEvent.click(screen.getByRole("button", { name: "Record offline payment" }));
    fireEvent.change(screen.getByLabelText(/Bank UTR \/ instrument number/), { target: { value: "SBIN523345678901" } });
    fireEvent.change(screen.getByLabelText(/^Paid on/), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText(/Reason \/ note/), { target: { value: "NEFT received" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(await screen.findByText(/already been recorded for this organisation/)).toBeInTheDocument();
    expect(screen.queryByText("internal")).not.toBeInTheDocument();
  });

  it("the pending card: the requester waits; a different administrator can approve or reject (reject needs a reason)", async () => {
    const { unmount } = render(ui(data({ payments: [row({ requestedByMe: true, canDecide: false })] })));
    const card = screen.getByTestId("pending-card");
    expect(card).toHaveTextContent("Requested by you");
    expect(card).toHaveTextContent(/A different administrator must approve or reject your request/);
    expect(within(card).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record offline payment" })).not.toBeInTheDocument(); // one pending at a time
    unmount();

    render(ui(data({ payments: [row()] })));
    const c2 = screen.getByTestId("pending-card");
    expect(c2).toHaveTextContent("Requested by another administrator");
    fireEvent.click(within(c2).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "UTR not on the statement" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(posts(fetchSpy)).toHaveLength(1));
    expect(String(posts(fetchSpy)[0]![0])).toBe(`/api/proxy/v1/billing/invoices/${invoice.id}/offline-payments/r1/decision`);
    expect(body(posts(fetchSpy)[0]!)).toEqual({ approve: false, reason: "UTR not on the statement" });
  });

  it("approve sends approve:true with no mandatory reason", async () => {
    render(ui(data({ payments: [row()] })));
    fireEvent.click(within(screen.getByTestId("pending-card")).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹2,500.50");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts(fetchSpy)).toHaveLength(1));
    expect(body(posts(fetchSpy)[0]!)).toEqual({ approve: true });
  });

  it("view-only roles and non-settleable invoices get no controls, only an explanation", () => {
    const { unmount } = render(ui(data({ canOperate: false, payments: [row()] })));
    expect(screen.queryByRole("button", { name: "Approve" })).toBeInTheDocument(); // canDecide comes from the server
    expect(screen.getAllByText(/Only platform billing administrators/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Record offline payment" })).not.toBeInTheDocument();
    unmount();
    render(ui(data(), { ...invoice, status: "paid", outstandingMinor: "0" }));
    expect(screen.queryByRole("button", { name: "Record offline payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send reminder" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/already paid, cancelled, waived or still a draft/).length).toBeGreaterThan(0);
  });

  it("renders in Hindi", () => {
    render(ui(data(), invoice, "hi"));
    expect(screen.getByRole("button", { name: "ऑफ़लाइन भुगतान दर्ज करें" })).toBeInTheDocument();
  });
});

describe("InvoiceOpsPanel: reminder", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { vi.restoreAllMocks(); fetchSpy = vi.fn(async () => json({ data: { lastSentAt: null, nextAllowedAt: null, count: 0 } })); vi.stubGlobal("fetch", fetchSpy); });

  it("shows the last-sent time and disables the button until the next allowed time", () => {
    render(ui(data({ reminders: { lastSentAt: "2026-10-02T06:30:00.000Z", nextAllowedAt: "2026-10-03T06:30:00.000Z", count: 1 } })));
    expect(screen.getByText(/Last reminder sent/)).toBeInTheDocument();
    expect(screen.getByText(/The next reminder can be sent after/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reminder" })).toBeDisabled();
  });

  it("sends, then reports how many administrators it was queued for and refreshes the last-sent time", async () => {
    fetchSpy.mockImplementation(async (_u: unknown, init?: RequestInit) =>
      init?.method === "POST" ? json({ id: "x", recipientCount: 2 }, 202) : json({ data: { lastSentAt: "2026-10-03T06:30:00.000Z", nextAllowedAt: "2026-10-04T06:30:00.000Z", count: 1 } }));
    render(ui(data()));
    expect(screen.getByText(/No reminder has been sent for this invoice yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send reminder" }));
    expect(await screen.findByText("Reminder queued for 2 administrator(s).")).toBeInTheDocument();
    expect(String(posts(fetchSpy)[0]![0])).toBe(`/api/proxy/v1/billing/invoices/${invoice.id}/reminders`);
    await waitFor(() => expect(screen.getByText(/Last reminder sent/)).toBeInTheDocument());
  });

  it.each([
    [422, "NO_RECIPIENTS", /Nothing was sent: this organisation has no active tenant administrator/],
    [503, "RECIPIENTS_UNAVAILABLE", /Nothing was sent: the administrators could not be looked up/],
    [429, "REMINDER_RATE_LIMITED", /already sent for this invoice in the last 24 hours/],
  ])("%s %s is a clear message, never a silent success", async (status, code, text) => {
    fetchSpy.mockImplementation(async () => json({ code, message: "internal" }, status));
    render(ui(data()));
    fireEvent.click(screen.getByRole("button", { name: "Send reminder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByText(/Reminder queued/)).not.toBeInTheDocument();
  });
});

// Review: maker-checker OFF is always visible, settings card, IST date floor, platform-only roles
describe("InvoiceOpsPanel: two-person approval OFF and billing settings", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { vi.restoreAllMocks(); fetchSpy = vi.fn(async () => json({ data: {} }, 202)); vi.stubGlobal("fetch", fetchSpy); });
  const off = { ...settingsOn, offlineMakerChecker: false };

  it("shows a persistent notice and OFF-specific copy in the dialog and the submitted message", async () => {
    fetchSpy.mockImplementation(async (_u: unknown, init?: RequestInit) => init?.method === "POST" ? json({ id: "x" }, 202) : json({ data: [] }));
    render(ui(data({ settings: off })));
    expect(screen.getByTestId("maker-off-notice")).toHaveTextContent(/Two-person approval is switched off/);
    fireEvent.click(screen.getByRole("button", { name: "Record offline payment" }));
    expect(screen.getByText(/this payment is applied immediately and the invoice is marked paid/)).toBeInTheDocument();
    expect(screen.queryByText(/A different billing administrator must approve/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Bank UTR \/ instrument number/), { target: { value: "SBIN523345678901" } });
    fireEvent.change(screen.getByLabelText(/^Paid on/), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText(/Reason \/ note/), { target: { value: "NEFT received" } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment now" }));
    expect(await screen.findByText(/Payment recorded\. The invoice is being marked as paid/)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for a second administrator/)).not.toBeInTheDocument();
  });

  it("with it ON there is no OFF notice, and Hindi has the OFF copy", () => {
    const { unmount } = render(ui(data()));
    expect(screen.queryByTestId("maker-off-notice")).not.toBeInTheDocument();
    unmount();
    render(ui(data({ settings: off }), invoice, "hi"));
    expect(screen.getByTestId("maker-off-notice")).toHaveTextContent("दो-व्यक्ति अनुमोदन बंद है");
  });

  it("the settings card: switching OFF is a request with a mandatory reason; ON is immediate", async () => {
    const { unmount } = render(ui(data()));
    const card = screen.getByTestId("billing-settings");
    expect(card).toHaveTextContent(/On: a different administrator must approve every offline payment/);
    fireEvent.click(within(card).getByRole("button", { name: "Request to switch off" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Request to switch off" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "one administrator on duty" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(posts(fetchSpy)).toHaveLength(1));
    expect(String(posts(fetchSpy)[0]![0])).toBe("/api/proxy/v1/billing/settings/maker-checker");
    expect(body(posts(fetchSpy)[0]!)).toEqual({ enabled: false, reason: "one administrator on duty" });
    unmount();
    fetchSpy.mockClear();
    render(ui(data({ settings: off })));
    fireEvent.click(within(screen.getByTestId("billing-settings")).getByRole("button", { name: "Switch back on" }));
    const d2 = await screen.findByRole("alertdialog");
    fireEvent.change(within(d2).getByRole("textbox"), { target: { value: "back to two-person control" } });
    fireEvent.click(within(d2).getByRole("button", { name: "Switch back on" }));
    await waitFor(() => expect(body(posts(fetchSpy)[0]!)).toEqual({ enabled: true, reason: "back to two-person control" }));
  });

  it("a pending switch-off request: the requester waits, another administrator approves; a refused request shows the plain message", async () => {
    const pendingReq = (mine: boolean) => ({ ...settingsOn, pendingMakerCheckerRequest: { id: "q1", reason: "small office", requestedByMe: mine, createdAt: "2026-10-01T00:00:00.000Z" } });
    const { unmount } = render(ui(data({ settings: pendingReq(true) })));
    expect(screen.getByTestId("billing-settings")).toHaveTextContent(/waiting for a second administrator|different administrator must approve or reject your request/);
    expect(within(screen.getByTestId("billing-settings")).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    unmount();
    fetchSpy.mockImplementation(async () => json({ code: "MAKER_CHECKER_VIOLATION" }, 409));
    render(ui(data({ settings: pendingReq(false) })));
    fireEvent.click(within(screen.getByTestId("billing-settings")).getByRole("button", { name: "Approve" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/must approve or reject this request, not the person who made it/)).toBeInTheDocument();
  });

  it("scheduled reminder days: empty = off, 1..365 saved, anything else rejected before a request", async () => {
    render(ui(data({ settings: { ...settingsOn, reminderOverdueDays: 30 } })));
    const input = screen.getByLabelText(/Send a reminder automatically/) as HTMLInputElement;
    expect(input.value).toBe("30");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/whole number of days from 1 to 365/)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "PUT")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PUT")).toBe(true));
    const put = fetchSpy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "PUT")!;
    expect(body(put)).toEqual({ days: null });
    expect(String(put[0])).toBe("/api/proxy/v1/billing/settings/reminder-days");
  });

  it("platform-only: no settings card for a non-operator", () => {
    render(ui(data({ canOperate: false })));
    expect(screen.queryByTestId("billing-settings")).not.toBeInTheDocument();
  });

  it("the date floor is the invoice's INDIA date: an invoice issued 2026-09-01 22:00 UTC is dated 2026-09-02 in India", async () => {
    render(ui(data(), { ...invoice, issuedAt: "2026-09-01T22:00:00.000Z" }));
    fireEvent.click(screen.getByRole("button", { name: "Record offline payment" }));
    fireEvent.change(screen.getByLabelText(/Bank UTR \/ instrument number/), { target: { value: "SBIN523345678901" } });
    fireEvent.change(screen.getByLabelText(/^Paid on/), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText(/Reason \/ note/), { target: { value: "NEFT received" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(await screen.findByText(/cannot be before the invoice date/)).toBeInTheDocument();
    expect(posts(fetchSpy)).toHaveLength(0);
  });
});
