import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => notFoundMock(),
}));

const getSessionUserIdMock = vi.fn(() => "checker-1");
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionUserId: () => getSessionUserIdMock(),
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

const ASSESSEE = { id: REFUND.assesseeId, ownerName: "Ravi Kumar", identifierNo: "PMC-0001" };
const RECEIPT = { id: REFUND.receiptId, receiptNo: "RCPT-001", amountMinor: "300000", channel: "online" };

function mockEnriched(refund = REFUND) {
  fetchJsonMock.mockImplementation((path: string) => {
    if (path.includes("/refunds/")) return Promise.resolve({ data: refund, source: "api", status: 200 });
    if (path.includes("/receipts")) return Promise.resolve({ data: [RECEIPT], source: "api" });
    if (path.includes("/assessees/")) return Promise.resolve({ data: ASSESSEE, source: "api" });
    return Promise.resolve({ data: null, source: "api" });
  });
}

describe("RefundDecidePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    notFoundMock.mockClear();
    getSessionUserIdMock.mockReturnValue("checker-1");
  });

  it("shows the amount, assessee name and receipt number (not raw UUIDs) and enables decide for a checker", async () => {
    mockEnriched();
    const ui = await RefundDecidePage({ params: { id: REFUND_ID } });
    render(ui);

    expect(screen.getByText(/₹2,500\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Ravi Kumar \(PMC-0001\)/)).toBeInTheDocument();
    expect(screen.getByText(/RCPT-001/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` })).toBeEnabled();
  });

  it("disables decide for the maker who raised the refund (GAP-REVENUE-REFUNDS-DETAIL-DECIDE-01)", async () => {
    getSessionUserIdMock.mockReturnValue("maker-1");
    mockEnriched();
    const ui = await RefundDecidePage({ params: { id: REFUND_ID } });
    render(ui);

    expect(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` })).toBeDisabled();
    expect(screen.getByText(/You raised this refund/)).toBeInTheDocument();
  });

  it("disables decide and shows the outcome for an already-decided refund (GAP-REVENUE-REFUNDS-DETAIL-DECIDE-02)", async () => {
    mockEnriched({ ...REFUND, status: "approved" });
    const ui = await RefundDecidePage({ params: { id: REFUND_ID } });
    render(ui);

    expect(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` })).toBeDisabled();
    expect(screen.getByText(/Already decided/)).toBeInTheDocument();
  });

  it("renders notFound() on a 404 (GAP-REVENUE-REFUNDS-DETAIL-DECIDE-04)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(RefundDecidePage({ params: { id: "99999999-9999-9999-9999-999999999999" } })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders a retry state (not notFound) on a 503/network error (GAP-REVENUE-REFUNDS-DETAIL-DECIDE-04)", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 503 });
    const ui = await RefundDecidePage({ params: { id: REFUND_ID } });
    render(ui);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    // Decide stays disabled.
    expect(screen.getByRole("button", { name: `Approve refund ${REFUND_ID.slice(0, 8)}` })).toBeDisabled();
    // Never fabricate an amount when the record couldn't load.
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });
});
