import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { WaiverDecideForm } from "./WaiverDecideForm";
import type { WaiverRecord } from "./page";

const WAIVER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const WAIVER: WaiverRecord = {
  id: WAIVER_ID,
  demandId: "d1111111-1111-1111-1111-111111111111",
  amountMinor: "25000",
  reason: "Hardship",
  status: "pending",
  requestedBy: "maker-1",
};

describe("WaiverDecideForm (GAP-REVENUE-WAIVERS-03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("fails closed: null record disables decide and never opens the dialog", () => {
    render(<WaiverDecideForm waiverId={WAIVER_ID} waiver={null} />);
    const approve = screen.getByRole("button", { name: `Approve waiver ${WAIVER_ID.slice(0, 8)}` });
    expect(approve).toBeDisabled();
    fireEvent.click(approve);
    expect(screen.queryByText("Approve this waiver?")).not.toBeInTheDocument();
  });

  it("disables decide for the maker (maker != checker)", () => {
    render(<WaiverDecideForm waiverId={WAIVER_ID} waiver={WAIVER} currentUserId="maker-1" />);
    expect(screen.getByRole("button", { name: `Approve waiver ${WAIVER_ID.slice(0, 8)}` })).toBeDisabled();
    expect(screen.getByText(/you raised this waiver/i)).toBeInTheDocument();
  });

  it("enables decide for a different officer and approves on confirm", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: WAIVER_ID, status: "accepted" }), { status: 202 }),
    );
    render(<WaiverDecideForm waiverId={WAIVER_ID} waiver={WAIVER} currentUserId="checker-9" />);
    fireEvent.click(screen.getByRole("button", { name: `Approve waiver ${WAIVER_ID.slice(0, 8)}` }));
    await waitFor(() => expect(screen.getByText("Approve this waiver?")).toBeInTheDocument());
    expect(screen.getByText(/₹250\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Approve waiver"));
    await waitFor(() => expect(screen.getByText(/Decision submitted \(approve/)).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  it("hides decide and shows status for an already-decided waiver", () => {
    render(
      <WaiverDecideForm waiverId={WAIVER_ID} waiver={{ ...WAIVER, status: "approved" }} currentUserId="checker-9" />,
    );
    expect(screen.queryByRole("button", { name: /Approve waiver/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Already decided/)).toBeInTheDocument();
  });

  it("requires a reason before reject confirms", async () => {
    render(<WaiverDecideForm waiverId={WAIVER_ID} waiver={WAIVER} currentUserId="checker-9" />);
    fireEvent.click(screen.getByRole("button", { name: `Reject waiver ${WAIVER_ID.slice(0, 8)}` }));
    await waitFor(() => expect(screen.getByText("Reject this waiver?")).toBeInTheDocument());
    expect(screen.getByText("Reject waiver")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Not eligible" } });
    expect(screen.getByText("Reject waiver")).toBeEnabled();
  });
});
