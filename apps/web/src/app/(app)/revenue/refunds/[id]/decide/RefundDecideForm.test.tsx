import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RefundDecideForm } from "./RefundDecideForm";

const REFUND_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("RefundDecideForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("has distinct accessible names for approve and reject", () => {
    render(<RefundDecideForm refundId={REFUND_ID} />);
    expect(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Reject refund ${REFUND_ID.slice(0, 8)}` })).toBeInTheDocument();
  });

  it("approves a refund on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: REFUND_ID, status: "accepted" }), { status: 202 }),
    );

    render(<RefundDecideForm refundId={REFUND_ID} />);
    fireEvent.click(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Approve this refund?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Approve refund"));

    await waitFor(() => {
      expect(screen.getByText(/Decision submitted \(approve/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces the real server code on a maker-checker violation (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "MAKER_CHECKER_VIOLATION", message: "Checker cannot be the same person as the maker (separation of duties)" } }),
        { status: 409 },
      ),
    );

    render(<RefundDecideForm refundId={REFUND_ID} />);
    fireEvent.click(screen.getByRole("button", { name: `Reject refund ${REFUND_ID.slice(0, 8)}` }));

    await waitFor(() => expect(screen.getByText("Reject this refund?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Reject refund"));

    await waitFor(() => {
      expect(screen.getByText(/MAKER_CHECKER_VIOLATION/)).toBeInTheDocument();
    });
  });
});
