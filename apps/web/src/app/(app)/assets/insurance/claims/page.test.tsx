import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import InsuranceClaimsPage from "./page";

const policiesPage = {
  data: [
    { id: "p1", policyNo: "POL-2026-001", insurer: "National Insurance Co", assetId: "a1", coverageMinor: "50000000", status: "active" },
  ],
  source: "api" as const,
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

describe("InsuranceClaimsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the claims list", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(policiesPage)
      .mockResolvedValueOnce({ data: [claimRow], source: "api" });

    const ui = await InsuranceClaimsPage({});
    render(ui);

    expect(screen.getAllByText(/POL-2026-001/).length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are no claims", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(policiesPage)
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await InsuranceClaimsPage({});
    render(ui);

    expect(screen.getByText("No claims filed")).toBeInTheDocument();
  });

  it("shows the data-source badge (no fabricated zero counts) when the claims loader errors", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(policiesPage)
      .mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await InsuranceClaimsPage({});
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
    expect(screen.queryByText("Total Claims")).not.toBeInTheDocument();
  });
});
