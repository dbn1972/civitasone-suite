import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AdjustmentApprovalQueue, type PendingAdjustment } from "./AdjustmentApprovalQueue";

const ROW: PendingAdjustment = {
  id: "pend-aaaaaaaa",
  createdAt: "2026-07-02T00:00:00.000Z",
  fromDemandId: "d1",
  toDemandId: "d2",
  amountMinor: "30000",
  reason: "Reallocate",
  status: "pending",
  makerUserId: "maker-9",
};

const FY = { d1: "FY 2025-2026", d2: "FY 2026-2027" };

describe("AdjustmentApprovalQueue (GAP-REVENUE-ADJUSTMENTS-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows an empty state when there are no pending transfers", () => {
    render(<AdjustmentApprovalQueue pending={[]} demandFyById={FY} currentUserId="checker-1" />);
    expect(screen.getByText("No transfers awaiting approval")).toBeInTheDocument();
  });

  it("enables Approve/Reject for a distinct checker and submits the decision (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { messageId: "m1" } }), { status: 202 }),
    );

    render(<AdjustmentApprovalQueue pending={[ROW]} demandFyById={FY} currentUserId="checker-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve transfer pend-aaa" }));

    await waitFor(() => expect(screen.getByText("Approve this transfer?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve transfer"));

    await waitFor(() => {
      expect(screen.getByText(/Decision submitted \(approve\)/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("disables Approve/Reject and explains why when the current user raised the transfer", () => {
    render(<AdjustmentApprovalQueue pending={[ROW]} demandFyById={FY} currentUserId="maker-9" />);
    expect(screen.getByRole("button", { name: "Approve transfer pend-aaa" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject transfer pend-aaa" })).toBeDisabled();
    expect(screen.getByText("You requested this transfer; a different officer must decide.")).toBeInTheDocument();
  });

  it("fails OPEN (buttons enabled) when the current user id is unknown — server still enforces", () => {
    render(<AdjustmentApprovalQueue pending={[ROW]} demandFyById={FY} currentUserId={null} />);
    expect(screen.getByRole("button", { name: "Approve transfer pend-aaa" })).toBeEnabled();
  });
});
