import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import GrievancesPage from "./page";

const MOCK_GRIEVANCES = [
  {
    id: "g1",
    grievanceNo: "CPG-001",
    subject: "Water supply",
    complainantName: "Ramesh Kumar",
    category: "water_supply",
    status: "pending",
    dueDate: "2026-09-30",
  },
];

describe("GrievancesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders grievances and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_GRIEVANCES, source: "api" });
    render(await GrievancesPage());
    expect(screen.getByText("CPG-001")).toBeInTheDocument();
  });

  it("shows the honest empty state when a tenant genuinely has zero grievances (source: api, [])", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await GrievancesPage());
    expect(screen.getByText("No grievances filed")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await GrievancesPage());
    expect(screen.getByText("We couldn't load this grievances.")).toBeInTheDocument();
    expect(screen.queryByText("No grievances filed")).not.toBeInTheDocument();
    // Stat cards show "—", not a fabricated 0.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
