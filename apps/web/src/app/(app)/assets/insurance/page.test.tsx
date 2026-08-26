import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import InsurancePoliciesPage from "./page";

const assetsPage = {
  data: [{ id: "a1", code: "AST-001", name: "Server Rack" }],
  source: "api" as const,
};

const policyRow = {
  id: "p1",
  assetId: "a1",
  policyNo: "POL-2026-001",
  insurer: "National Insurance Co",
  coverageMinor: "50000000",
  premiumMinor: "1250000",
  currency: "INR",
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  status: "active",
};

describe("InsurancePoliciesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the policies list", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({ data: [policyRow], source: "api" });

    const ui = await InsurancePoliciesPage();
    render(ui);

    expect(screen.getByText("POL-2026-001")).toBeInTheDocument();
    expect(screen.getByText("National Insurance Co")).toBeInTheDocument();
  });

  it("renders an empty state when there are no policies", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await InsurancePoliciesPage();
    render(ui);

    expect(screen.getByText("No insurance policies")).toBeInTheDocument();
  });

  it("shows the data-source badge (not a fabricated zero count) when the policies loader falls back on error", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await InsurancePoliciesPage();
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
    // The StatGrid (which would show a "0" count) must not render on error.
    expect(screen.queryByText("Total Policies")).not.toBeInTheDocument();
  });
});
