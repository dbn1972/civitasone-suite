import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import ReportsDashboardPage from "./page";

describe("ReportsDashboardPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // GAP-REPORTS-DASHBOARD-01
  it("on error shows no fabricated 12 / Real-time and renders the retry state", async () => {
    fetchJsonMock.mockResolvedValue({ data: { kpis: [] }, source: "error", status: 500 });
    render(await ReportsDashboardPage());
    expect(screen.queryByText("12")).not.toBeInTheDocument();
    expect(screen.queryByText("Real-time")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  // GAP-REPORTS-DASHBOARD-02 + 03
  it("renders a trending-up ratio card (not a composite index) and no FY/QTD control", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        kpis: [
          { id: "a", title: "A", module: "finance", value: 10, changeDirection: "up", changePct: 4 },
          { id: "b", title: "B", module: "hr", value: 20, changeDirection: "down", changePct: -2 },
        ],
      },
      source: "api",
      status: 200,
    });
    render(await ReportsDashboardPage());
    expect(screen.getByText("KPIs trending up")).toBeInTheDocument();
    expect(screen.getAllByText("50%").length).toBeGreaterThanOrEqual(1); // 1 of 2 directed KPIs up
    expect(screen.queryByText("composite")).not.toBeInTheDocument();
    expect(screen.queryByText("FY")).not.toBeInTheDocument();
    expect(screen.queryByText("QTD")).not.toBeInTheDocument();
    expect(screen.getByText("KPI values by module")).toBeInTheDocument();
  });

  // GAP-REPORTS-DASHBOARD-05
  it("alert line qualifies the change with a reference period", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { kpis: [{ id: "b", title: "B", module: "hr", value: 20, changeDirection: "down", changePct: -3 }] },
      source: "api",
      status: 200,
    });
    render(await ReportsDashboardPage());
    expect(screen.getByText(/-3.0% vs previous period/)).toBeInTheDocument();
  });

  it("empty kpis -> Data Sources is not a fabricated 12", async () => {
    fetchJsonMock.mockResolvedValue({ data: { kpis: [] }, source: "api", status: 200 });
    render(await ReportsDashboardPage());
    expect(screen.queryByText("12")).not.toBeInTheDocument();
  });
});
