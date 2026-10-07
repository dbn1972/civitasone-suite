import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import KPITrackerPage from "./page";

function kpi(over: Record<string, unknown> = {}) {
  return {
    id: "k1", kpiName: "Collection", module: "finance", targetValue: 100, currentValue: 80,
    unit: "%", achievementPct: 80, period: "Q1", trend: "up", status: "on_track", ...over,
  };
}

describe("KPITrackerPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // GAP-REPORTS-KPI-02
  it("on error shows dashes, not 0 / 0%, and the retry state", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await KPITrackerPage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    // "—" rendered for each stat value
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  // GAP-REPORTS-KPI-03
  it("has a 'Percentage KPIs' card and no fabricated '→ budget' delta", async () => {
    fetchJsonMock.mockResolvedValue({ data: [kpi()], source: "api", status: 200 });
    render(await KPITrackerPage());
    expect(screen.getByText("Percentage KPIs")).toBeInTheDocument();
    expect(screen.queryByText(/budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Outcome-linked")).not.toBeInTheDocument();
  });

  // GAP-REPORTS-KPI-05
  it("no 'Set Targets' action in the header", async () => {
    fetchJsonMock.mockResolvedValue({ data: [kpi()], source: "api", status: 200 });
    render(await KPITrackerPage());
    expect(screen.queryByRole("link", { name: /set targets/i })).not.toBeInTheDocument();
  });
});
