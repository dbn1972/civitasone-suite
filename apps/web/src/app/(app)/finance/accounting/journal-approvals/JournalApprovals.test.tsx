import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { JournalApprovals, mapPendingJournals, type PendingJournal } from "./JournalApprovals";

const J = (over: Partial<PendingJournal> = {}): PendingJournal => ({
  id: "8582e532-7041-45d3-93ef-1d8a89066f81", voucherNo: null, type: "journal", postingDate: "2026-11-03",
  narration: "JV cash to bank transfer", totalMinor: "250000", createdAt: "2026-11-03T03:40:00.000Z", isOwn: false,
  lines: [
    { accountCode: "1100", debitMinor: "250000", creditMinor: "0", narration: "JV cash to bank transfer" },
    { accountCode: "1101", debitMinor: "0", creditMinor: "250000", narration: "JV cash to bank transfer" },
  ],
  ...over,
});
const heads = { "1100": { code: "1100", name: "Cash / Bank" }, "1101": { code: "1101", name: "Bank - Salary" } };
const ui = (rows: PendingJournal[], canApprove = true, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
    <JournalApprovals initial={rows} canApprove={canApprove} heads={heads} />
  </NextIntlClientProvider>
);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("UAT P2 J6: journal approval screen", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.fn(async () => json({ id: "x", status: "accepted", correlationId: "c" }, 202));
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("lists a pending journal with its narration, named accounts and amount", () => {
    render(ui([J()]));
    expect(screen.getByText("JV cash to bank transfer")).toBeInTheDocument();
    expect(screen.getByText("1100 · Cash / Bank")).toBeInTheDocument();
    expect(screen.getByText("Allocated when approved")).toBeInTheDocument();
    expect(screen.getAllByText(/₹2,500\.00/).length).toBeGreaterThan(0);
  });

  it("a checker approves through the existing backend route after confirming; the row leaves the queue", async () => {
    render(ui([J()]));
    fireEvent.click(screen.getByRole("button", { name: "Approve and post" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve journal" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/journals/8582e532-7041-45d3-93ef-1d8a89066f81/approve");
    expect(init.method).toBe("PATCH");
    expect(await screen.findByText(/Journal approved/)).toBeInTheDocument();
    expect(screen.queryByTestId("pending-journal")).not.toBeInTheDocument();
  });

  it("the maker of a journal is not offered Approve (a different officer must approve)", () => {
    render(ui([J({ isOwn: true })]));
    expect(screen.queryByRole("button", { name: "Approve and post" })).not.toBeInTheDocument();
    expect(screen.getByText(/A different officer must approve it/)).toBeInTheDocument();
  });

  it("a reader without an approving role sees the queue but no Approve", () => {
    render(ui([J()], false));
    expect(screen.queryByRole("button", { name: "Approve and post" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only a finance administrator can approve/)).toBeInTheDocument();
  });

  it("a refused approval stays in the dialog as a readable message and keeps the row", async () => {
    fetchSpy.mockImplementation(async () => json({ code: "PERIOD_CLOSED", message: "This accounting period is closed." }, 422));
    render(ui([J()]));
    fireEvent.click(screen.getByRole("button", { name: "Approve and post" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve journal" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("pending-journal")).toBeInTheDocument();
    expect(screen.queryByText(/Journal approved/)).not.toBeInTheDocument();
  });

  it("an empty queue says so", () => {
    render(ui([]));
    expect(screen.getByText("No journals waiting for approval")).toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(ui([J()], true, "hi"));
    expect(screen.getByRole("button", { name: "स्वीकृत करें और पोस्ट करें" })).toBeInTheDocument();
  });

  it("maps the API payload and drops malformed rows", () => {
    expect(mapPendingJournals({ data: [{ id: "a", totalMinor: "100", lines: [] }, { id: "b", totalMinor: "1.5", lines: [] }, { id: "c" }] }))
      .toHaveLength(1);
    expect(mapPendingJournals({ nope: true })).toBeNull();
  });
});
