import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { RecurringEntriesTable, recurringActionBody, type RecurringEntryRow } from "./RecurringEntriesTable";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const row = (over: Partial<RecurringEntryRow> = {}): RecurringEntryRow => ({
  id: "r1", name: "Monthly Rent", voucherType: "journal", frequency: "monthly", amountMinor: "12000000",
  nextRunDateDisplay: "01 Nov 2026", endDateDisplay: "—", statusLabel: "active", ...over,
});

function renderTable(entries: RecurringEntryRow[]) {
  return render(<RecurringEntriesTable entries={entries} />);
}

describe("recurringActionBody", () => {
  it("pause/resume toggle isActive; end sets today as the end date and deactivates", () => {
    expect(recurringActionBody("pause", "2026-10-02")).toEqual({ isActive: false });
    expect(recurringActionBody("resume", "2026-10-02")).toEqual({ isActive: true });
    expect(recurringActionBody("end", "2026-10-02")).toEqual({ isActive: false, endDate: "2026-10-02" });
  });
});

describe("RecurringEntriesTable (GAP-FINANCE-RECURRING-ENTRIES-01)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("Pause asks to confirm with name, amount in rupees and next run, then PATCHes isActive:false and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderTable([row()]);
    fireEvent.click(screen.getByRole("button", { name: "Pause Monthly Rent" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Monthly Rent");
    expect(dialog).toHaveTextContent("₹1,20,000.00");
    expect(dialog).toHaveTextContent("01 Nov 2026");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/recurring-entries/r1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ isActive: false });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("an inactive template offers Resume", () => {
    renderTable([row({ statusLabel: "inactive" })]);
    expect(screen.getByRole("button", { name: "Resume Monthly Rent" })).toBeInTheDocument();
  });

  it("a failed change shows a clerk-safe error in the dialog and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    renderTable([row()]);
    fireEvent.click(screen.getByRole("button", { name: "End Monthly Rent now" }));
    fireEvent.click(await screen.findByRole("button", { name: "End now", hidden: false }));
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // review LOW: ended template + role gating
  it("an ended template (inactive, past end date) offers neither Resume nor End", () => {
    renderTable([row({ statusLabel: "inactive", endDateDisplay: "01 Sep 2026", ended: true })]);
    expect(screen.queryByRole("button", { name: /Resume|End/ })).not.toBeInTheDocument();
  });

  it("a session without a write role gets no action column at all", () => {
    render(<RecurringEntriesTable entries={[row()]} canWrite={false} />);
    expect(screen.queryByRole("button", { name: /Pause|Resume|End/ })).not.toBeInTheDocument();
    expect(screen.getByText("Monthly Rent")).toBeInTheDocument();
  });
});
