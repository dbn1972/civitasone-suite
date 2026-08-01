import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PolicyDetailPage from "./page";

const policyDetail = {
  id: "p1",
  assetId: "a1",
  policyNo: "POL-2026-001",
  insurer: "National Insurance Co",
  coverageMinor: "50000000",
  premiumMinor: "1250000",
  currency: "INR",
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  renewalReminderDays: 30,
  status: "active",
};

const claimRow = {
  id: "c1",
  policyId: "p1",
  assetId: "a1",
  claimDate: "2026-06-15",
  claimAmountMinor: "800000",
  settledAmountMinor: "0",
  status: "pending",
};

describe("PolicyDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the policy details and its claims", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: policyDetail, source: "api" })
      .mockResolvedValueOnce({ data: [claimRow], source: "api" });

    const ui = await PolicyDetailPage({ params: { id: "p1" } });
    render(ui);

    expect(screen.getAllByText(/POL-2026-001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("National Insurance Co").length).toBeGreaterThan(0);
  });

  it("renders empty state for claims when none exist", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: policyDetail, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await PolicyDetailPage({ params: { id: "p1" } });
    render(ui);

    expect(screen.getByText("No claims filed")).toBeInTheDocument();
  });

  it("renders a not-found empty state when the policy loader returns null (real 404, not fabricated)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await PolicyDetailPage({ params: { id: "missing" } });
    render(ui);

    // The EmptyState body ("h4") is the tell that we rendered the guided
    // not-found state rather than the data-source badge below.
    expect(
      screen.getByText("The requested policy could not be found. It may have lapsed or the link is incorrect."),
    ).toBeInTheDocument();
  });

  it("shows the data-source badge (not the guided not-found empty state) when the loader errors", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await PolicyDetailPage({ params: { id: "p1" } });
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("The requested policy could not be found. It may have lapsed or the link is incorrect."),
    ).not.toBeInTheDocument();
  });
});
