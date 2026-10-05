import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QuotationApprovalPanel } from "./QuotationApprovalPanel";
import * as qp from "@/lib/crm/quotation";

vi.mock("@/lib/crm/quotation", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/quotation")>();
  return { ...actual, getApprovals: vi.fn(), requestApproval: vi.fn(), approveApproval: vi.fn(), rejectApproval: vi.fn() };
});

beforeEach(() => {
  vi.mocked(qp.getApprovals).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(qp.requestApproval).mockReset();
  vi.mocked(qp.approveApproval).mockReset();
  vi.mocked(qp.rejectApproval).mockReset();
});

const pending: qp.ApprovalRequest = {
  id: "a1", quotationId: "q1", type: "discount", amountBps: 1500, reason: "big", status: "pending", requestedBy: "rep-7",
};

describe("QuotationApprovalPanel (QP-004)", () => {
  it("reports a blocking pending approval to the parent", async () => {
    vi.mocked(qp.getApprovals).mockResolvedValue({ data: [pending], source: "api" });
    const onBlockingChange = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={enMessages}><QuotationApprovalPanel quotationId="q1" onBlockingChange={onBlockingChange} /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/sending is blocked/i)).toBeInTheDocument());
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
  });

  it("requests a discount approval with bps from the entered percent", async () => {
    vi.mocked(qp.requestApproval).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><QuotationApprovalPanel quotationId="q1" /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no approvals requested/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/discount percent/i), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText(/approval reason/i), { target: { value: "strategic" } });
    fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
    await waitFor(() =>
      expect(qp.requestApproval).toHaveBeenCalledWith("q1", { type: "discount", reason: "strategic", amountBps: 1250 }),
    );
  });

  it("blocks a request with no reason", async () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><QuotationApprovalPanel quotationId="q1" /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no approvals requested/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/discount percent/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    expect(qp.requestApproval).not.toHaveBeenCalled();
  });

  // GAP-CRM-QUOTATIONS-01: a user without an approve role must never be
  // offered Approve/Reject on a pending request.
  it("hides Approve/Reject when the user cannot approve", async () => {
    vi.mocked(qp.getApprovals).mockResolvedValue({ data: [pending], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><QuotationApprovalPanel quotationId="q1" canApprove={false} currentUserId="someone" /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/sending is blocked/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/awaiting an approver/i)).toBeInTheDocument();
  });

  // Maker-checker: an approver who raised the request may not approve it.
  it("hides Approve/Reject on the requester's own row even with the approve role", async () => {
    vi.mocked(qp.getApprovals).mockResolvedValue({ data: [pending], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><QuotationApprovalPanel quotationId="q1" canApprove currentUserId="rep-7" /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/sending is blocked/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/you raised this/i)).toBeInTheDocument();
  });

  it("shows Approve/Reject to a different approver and grants", async () => {
    vi.mocked(qp.getApprovals)
      .mockResolvedValueOnce({ data: [pending], source: "api" })
      .mockResolvedValue({ data: [{ ...pending, status: "approved" }], source: "api" });
    vi.mocked(qp.approveApproval).mockResolvedValue(undefined);
    const onBlockingChange = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={enMessages}><QuotationApprovalPanel quotationId="q1" canApprove currentUserId="mgr-2" onBlockingChange={onBlockingChange} /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(screen.getByText(/all approvals granted/i)).toBeInTheDocument());
    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
  });

  // Reject requires a reason (ConfirmDialog) and calls decide with 'reject'.
  it("rejects a pending request with a reason via rejectApproval", async () => {
    vi.mocked(qp.getApprovals)
      .mockResolvedValueOnce({ data: [pending], source: "api" })
      .mockResolvedValue({ data: [{ ...pending, status: "rejected" }], source: "api" });
    vi.mocked(qp.rejectApproval).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><QuotationApprovalPanel quotationId="q1" canApprove currentUserId="mgr-2" /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    const dialog = await screen.findByRole("alertdialog");
    // Confirm is gated on a reason.
    const confirm = within(dialog).getByRole("button", { name: /reject request/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason for rejection/i), { target: { value: "Discount too deep" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(qp.rejectApproval).toHaveBeenCalledWith("a1", "Discount too deep"));
    expect(await screen.findByText(/^rejected$/i)).toBeInTheDocument();
  });
});
