import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuotationApprovalPanel } from "./QuotationApprovalPanel";
import * as qp from "@/lib/crm/quotation";

vi.mock("@/lib/crm/quotation", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/quotation")>();
  return { ...actual, getApprovals: vi.fn(), requestApproval: vi.fn(), approveApproval: vi.fn() };
});

beforeEach(() => {
  vi.mocked(qp.getApprovals).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(qp.requestApproval).mockReset();
  vi.mocked(qp.approveApproval).mockReset();
});

describe("QuotationApprovalPanel (QP-004)", () => {
  it("reports a blocking pending approval to the parent", async () => {
    vi.mocked(qp.getApprovals).mockResolvedValue({
      data: [{ id: "a1", quotationId: "q1", type: "discount", amountBps: 1500, reason: "big", status: "pending" }],
      source: "api",
    });
    const onBlockingChange = vi.fn();
    render(<QuotationApprovalPanel quotationId="q1" onBlockingChange={onBlockingChange} />);
    await waitFor(() => expect(screen.getByText(/sending is blocked/i)).toBeInTheDocument());
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
  });

  it("requests a discount approval with bps from the entered percent", async () => {
    vi.mocked(qp.requestApproval).mockResolvedValue(undefined);
    render(<QuotationApprovalPanel quotationId="q1" />);
    await waitFor(() => expect(screen.getByText(/no approvals requested/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/discount percent/i), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText(/approval reason/i), { target: { value: "strategic" } });
    fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
    await waitFor(() =>
      expect(qp.requestApproval).toHaveBeenCalledWith("q1", { type: "discount", reason: "strategic", amountBps: 1250 }),
    );
  });

  it("blocks a request with no reason", async () => {
    render(<QuotationApprovalPanel quotationId="q1" />);
    await waitFor(() => expect(screen.getByText(/no approvals requested/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/discount percent/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^request$/i }));
    expect(await screen.findByText(/reason is required/i)).toBeInTheDocument();
    expect(qp.requestApproval).not.toHaveBeenCalled();
  });

  it("grants an approval and reports it no longer blocks", async () => {
    vi.mocked(qp.getApprovals)
      .mockResolvedValueOnce({ data: [{ id: "a1", quotationId: "q1", type: "deviation", reason: "terms", status: "pending" }], source: "api" })
      .mockResolvedValue({ data: [{ id: "a1", quotationId: "q1", type: "deviation", reason: "terms", status: "approved" }], source: "api" });
    vi.mocked(qp.approveApproval).mockResolvedValue(undefined);
    const onBlockingChange = vi.fn();
    render(<QuotationApprovalPanel quotationId="q1" onBlockingChange={onBlockingChange} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(screen.getByText(/all approvals granted/i)).toBeInTheDocument());
    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
  });
});
