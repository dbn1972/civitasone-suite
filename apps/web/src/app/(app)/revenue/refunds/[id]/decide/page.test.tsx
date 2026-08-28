import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RefundDecidePage from "./page";

const REFUND_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const REFUND = {
  id: REFUND_ID,
  receiptId: "11111111-1111-1111-1111-111111111111",
  assesseeId: "22222222-2222-2222-2222-222222222222",
  amountMinor: "250000",
  reason: "Duplicate payment",
  status: "pending",
  makerUserId: "maker-1",
};

describe("RefundDecidePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the amount, reason and status when the refund loads (never blind approval)", async () => {
    fetchJsonMock.mockResolvedValue({ data: REFUND, source: "api" });
    const ui = await RefundDecidePage({ params: { id: REFUND_ID } });
    render(ui);

    expect(screen.getByText(/₹2,500\.00/)).toBeInTheDocument();
    expect(screen.getByText("Duplicate payment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` })).toBeEnabled();
  });

  it("disables Approve/Reject and shows the data-source badge when the record fails to load (fail-closed)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });
    const ui = await RefundDecidePage({ params: { id: REFUND_ID } });
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Reject refund ${REFUND_ID.slice(0, 8)}` })).toBeDisabled();
    // Never fabricate an amount when the record couldn't load.
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("disables Approve/Reject on a 404 (unknown refund id) — also fail-closed", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });
    const ui = await RefundDecidePage({ params: { id: "99999999-9999-9999-9999-999999999999" } });
    render(ui);

    expect(screen.getByRole("button", { name: /Approve refund/ })).toBeDisabled();
  });
});
