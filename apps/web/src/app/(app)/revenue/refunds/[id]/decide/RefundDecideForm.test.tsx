import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RefundDecideForm } from "./RefundDecideForm";
import type { RefundRecord } from "./page";

const REFUND_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const REFUND: RefundRecord = {
  id: REFUND_ID,
  receiptId: "11111111-1111-1111-1111-111111111111",
  assesseeId: "22222222-2222-2222-2222-222222222222",
  amountMinor: "250000",
  reason: "Duplicate payment",
  status: "pending",
  makerUserId: "maker-1",
};

describe("RefundDecideForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("has distinct accessible names for approve and reject", () => {
    render(<RefundDecideForm refundId={REFUND_ID} refund={REFUND} />);
    expect(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Reject refund ${REFUND_ID.slice(0, 8)}` })).toBeInTheDocument();
  });

  it("disables Approve/Reject and never opens the confirm dialog when the refund record could not be loaded (fail-closed)", () => {
    render(<RefundDecideForm refundId={REFUND_ID} refund={null} />);
    const approveBtn = screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` });
    const rejectBtn = screen.getByRole("button", { name: `Reject refund ${REFUND_ID.slice(0, 8)}` });
    expect(approveBtn).toBeDisabled();
    expect(rejectBtn).toBeDisabled();

    fireEvent.click(approveBtn);
    expect(screen.queryByText("Approve this refund?")).not.toBeInTheDocument();
  });

  it("shows the amount and reason in the confirm dialog so the checker never decides blind", async () => {
    render(<RefundDecideForm refundId={REFUND_ID} refund={REFUND} />);
    fireEvent.click(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Approve this refund?")).toBeInTheDocument());
    expect(screen.getByText(/₹2,500\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicate payment/)).toBeInTheDocument();
  });

  it("approves a refund on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: REFUND_ID, status: "accepted" }), { status: 202 }),
    );

    render(<RefundDecideForm refundId={REFUND_ID} refund={REFUND} />);
    fireEvent.click(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Approve this refund?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve refund"));

    await waitFor(() => {
      expect(screen.getByText(/Decision submitted \(approve/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("requires a reason before the reject confirm button is enabled (audit parity)", async () => {
    render(<RefundDecideForm refundId={REFUND_ID} refund={REFUND} />);
    fireEvent.click(screen.getByRole("button", { name: `Reject refund ${REFUND_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Reject this refund?")).toBeInTheDocument());
    expect(screen.getByText("Reject refund")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Amount does not match receipt" } });
    expect(screen.getByText("Reject refund")).toBeEnabled();
  });

  it("surfaces the real server code on a maker-checker violation (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "MAKER_CHECKER_VIOLATION", message: "Checker cannot be the same person as the maker (separation of duties)" } }),
        { status: 409 },
      ),
    );

    render(<RefundDecideForm refundId={REFUND_ID} refund={REFUND} />);
    fireEvent.click(screen.getByRole("button", { name: `Reject refund ${REFUND_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Reject this refund?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Not eligible" } });
    fireEvent.click(screen.getByText("Reject refund"));

    await waitFor(() => {
      expect(screen.getByText(/MAKER_CHECKER_VIOLATION/)).toBeInTheDocument();
    });
  });
});
