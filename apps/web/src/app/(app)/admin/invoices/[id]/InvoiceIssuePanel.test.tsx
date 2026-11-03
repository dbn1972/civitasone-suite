import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import type { AdminInvoiceDetail } from "@/app/_data/loaders";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { InvoiceIssuePanel } from "./InvoiceIssuePanel";

const ME = "82310d88-a7e7-440d-95b5-b40fd1898232";
const OTHER = "0a82f891-2b3c-43c3-af76-a5418f2c658f";
const draft: AdminInvoiceDetail = {
  id: "7fde1e7f-0741-4e2c-b25b-703dd937ee4f", periodMonth: "2026-11", status: "draft", currency: "INR",
  totalMinor: "250000", taxMinor: "0", chargesMinor: "0", paidMinor: "0", outstandingMinor: "250000",
  issuedAt: null, paidAt: null, cancelledAt: null, cancelReason: null, items: [], approvals: [],
};
const pending = (requestedBy: string): AdminInvoiceDetail => ({
  ...draft, approvals: [{ id: "a1", action: "issue", status: "pending", amountMinor: "250000", decidedAt: null, reason: null, requestedBy }],
});
const ui = (inv: AdminInvoiceDetail, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}><InvoiceIssuePanel invoice={inv} currentUserId={ME} /></NextIntlClientProvider>
);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("UAT P2 J8: issue an invoice on screen", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockReset();
    fetchSpy = vi.fn(async () => json({ id: draft.id, status: "accepted", requiresApproval: false }, 202));
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("a draft offers Issue; confirming calls PATCH /issue and refreshes", async () => {
    render(ui(draft));
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Issue" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/billing/invoices/${draft.id}/issue`);
    expect(init.method).toBe("PATCH");
    expect(await screen.findByText(/Invoice issued/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("a large invoice is reported as sent for approval", async () => {
    fetchSpy.mockImplementation(async () => json({ id: draft.id, status: "pending_approval", requiresApproval: true }, 202));
    render(ui(draft));
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    fireEvent.click(screen.getByRole("button", { name: "Issue" }));
    expect(await screen.findByText(/Sent for approval/)).toBeInTheDocument();
  });

  it("the requester of a pending issue is not offered Approve", () => {
    render(ui(pending(ME)));
    expect(screen.queryByRole("button", { name: "Approve issue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue invoice" })).not.toBeInTheDocument();
    expect(screen.getByText(/A different administrator must approve or reject your request/)).toBeInTheDocument();
  });

  it("a different administrator approves through PATCH /approvals/:id", async () => {
    render(ui(pending(OTHER)));
    fireEvent.click(screen.getByRole("button", { name: "Approve issue" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Approve issue" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/billing/invoices/${draft.id}/approvals/a1`);
    expect(JSON.parse(init.body as string)).toEqual({ approve: true });
  });

  it("an issued invoice with nothing pending shows no panel", () => {
    const { container } = render(ui({ ...draft, status: "issued" }));
    expect(container.querySelector("[data-testid=invoice-issue-panel]")).toBeNull();
  });

  it("renders in Hindi", () => {
    render(ui(draft, "hi"));
    expect(screen.getAllByText("बीजक जारी करें").length).toBeGreaterThan(0);
  });
});
