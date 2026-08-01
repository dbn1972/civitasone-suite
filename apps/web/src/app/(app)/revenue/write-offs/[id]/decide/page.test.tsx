import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import WriteOffDecidePage from "./page";

const WRITE_OFF_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const WRITE_OFF = {
  id: WRITE_OFF_ID,
  assesseeId: "22222222-2222-2222-2222-222222222222",
  amountMinor: "100000",
  reason: "Unrecoverable after legal proceedings",
  status: "pending",
  makerUserId: "maker-1",
};

describe("WriteOffDecidePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the amount, reason and status when the write-off loads (never blind approval)", async () => {
    fetchJsonMock.mockResolvedValue({ data: WRITE_OFF, source: "api" });
    const ui = await WriteOffDecidePage({ params: { id: WRITE_OFF_ID } });
    render(ui);

    expect(screen.getByText(/₹1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText("Unrecoverable after legal proceedings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` })).toBeEnabled();
  });

  it("disables Approve/Reject and shows the data-source badge when the record fails to load (fail-closed)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });
    const ui = await WriteOffDecidePage({ params: { id: WRITE_OFF_ID } });
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: `Approve write-off ${WRITE_OFF_ID.slice(0, 8)}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Reject write-off ${WRITE_OFF_ID.slice(0, 8)}` })).toBeDisabled();
    // Never fabricate an amount when the record couldn't load.
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("disables Approve/Reject on a 404 (unknown write-off id) — also fail-closed", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });
    const ui = await WriteOffDecidePage({ params: { id: "99999999-9999-9999-9999-999999999999" } });
    render(ui);

    expect(screen.getByRole("button", { name: /Approve write-off/ })).toBeDisabled();
  });
});
