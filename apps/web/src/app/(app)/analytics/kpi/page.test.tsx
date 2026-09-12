import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import KpiPage from "./page";

const MOCK_ROWS = [
  { kpiName: "Grievance TAT", category: "Citizen Services", currentValue: "4.2d", target: "5d", trend: "↑ improving", owner: "CRM" },
  { kpiName: "Revenue Collection", category: "Finance", currentValue: "92%", target: "92%", trend: "flat", owner: "Finance" },
];

function mockKpis(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/analytics/kpis")) {
      return Promise.resolve(result);
    }
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("KpiPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real KPI rows and stat counts on success", async () => {
    mockKpis({ data: MOCK_ROWS, source: "api" });
    render(await KpiPage());
    expect(screen.getByText("Total KPIs").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Grievance TAT")).toBeInTheDocument();
  });

  it("shows the honest empty state when a tenant genuinely has zero KPIs (source: api, [])", async () => {
    mockKpis({ data: [], source: "api" });
    render(await KpiPage());
    expect(screen.getByText("No KPIs defined")).toBeInTheDocument();
    // Real zero counts, not dashes — a genuine empty tenant, not an outage.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    mockKpis({ data: [], source: "error" });
    render(await KpiPage());
    expect(screen.getByText("We couldn't load this KPIs.")).toBeInTheDocument();
    expect(screen.queryByText("No KPIs defined")).not.toBeInTheDocument();
    // Stat cards show "—", not a fabricated 0 derived from the empty error payload.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
