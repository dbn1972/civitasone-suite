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

import InstalmentPlanDetailPage from "./page";

const PLAN = {
  id: "p1",
  totalMinor: "1200000",
  instalmentCount: 4,
  startDate: "2026-04-01",
  status: "active",
  schedule: [
    { id: "i1", sequenceNo: 1, dueDate: "2026-04-01", amountMinor: "300000", paidMinor: "0", status: "pending" },
    { id: "i2", sequenceNo: 2, dueDate: "2026-05-01", amountMinor: "300000", paidMinor: "0", status: "pending" },
    { id: "i3", sequenceNo: 3, dueDate: "2026-06-01", amountMinor: "300000", paidMinor: "0", status: "pending" },
    { id: "i4", sequenceNo: 4, dueDate: "2026-07-01", amountMinor: "300000", paidMinor: "0", status: "pending" },
  ],
};

describe("InstalmentPlanDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    notFoundMock.mockClear();
  });

  it("renders the plan header and schedule lines summing to the total (GAP-REVENUE-INSTALMENTS-02)", async () => {
    fetchJsonMock.mockResolvedValue({ data: PLAN, source: "api", status: 200 });
    const ui = await InstalmentPlanDetailPage({ params: { id: "p1" } });
    render(ui);

    expect(screen.getByText("Schedule")).toBeInTheDocument();
    // Four schedule rows, each ₹3,000.00.
    expect(screen.getAllByText("₹3,000.00").length).toBe(4);
    // Total ₹12,000.00 shown in the stat grid.
    expect(screen.getByText("₹12,000.00")).toBeInTheDocument();
  });

  it("renders notFound() on a 404", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(InstalmentPlanDetailPage({ params: { id: "missing" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders a retry state (not notFound) on a 503", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 503 });
    const ui = await InstalmentPlanDetailPage({ params: { id: "p1" } });
    render(ui);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});
