import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./DashboardsTable", () => ({
  DashboardsTable: ({ dashboards }: { dashboards: unknown[] }) => <div>dashboards-table:{dashboards.length}</div>,
}));

import AnalyticsDashboardsPage from "./page";

const MOCK_DASHBOARDS = [
  { id: "d1", name: "Budget Overview", description: null, status: "active", visibility: "shared", version: 1 },
  { id: "d2", name: "HR KPIs", description: null, status: "draft", visibility: "private", version: 1 },
];

function mockDashboardsLoader(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/analytics/dashboards")) return Promise.resolve(result);
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("AnalyticsDashboardsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real stat counts when the loader succeeds", async () => {
    mockDashboardsLoader({ data: MOCK_DASHBOARDS, source: "api" });
    render(await AnalyticsDashboardsPage());
    expect(screen.getByText("Total").closest(".stat")).toHaveTextContent("2");
    expect(screen.getByText("Active").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Shared").closest(".stat")).toHaveTextContent("1");
  });

  it("renders — for every stat, not a fabricated zero, when the loader fails", async () => {
    // Bug A / UX-013: `source` was already fetched here (and handed to
    // DashboardsTable's own badge, UX-012) but never gated the stat values
    // -- `dashboards` defaults to `[]` on error, so "Total 0 / Active 0 /
    // Shared 0" was indistinguishable from a tenant that genuinely has none
    // yet.
    mockDashboardsLoader({ data: [], source: "error" });
    render(await AnalyticsDashboardsPage());
    expect(screen.getByText("Total").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Active").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Shared").closest(".stat")).toHaveTextContent("—");
  });

  it("still shows the honest empty state (0, not —) when a tenant genuinely has zero dashboards", async () => {
    mockDashboardsLoader({ data: [], source: "api" });
    render(await AnalyticsDashboardsPage());
    expect(screen.getByText("Total").closest(".stat")).toHaveTextContent("0");
    expect(screen.getByText("dashboards-table:0")).toBeInTheDocument();
  });
});
