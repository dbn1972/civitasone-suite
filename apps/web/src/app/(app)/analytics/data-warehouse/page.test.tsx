import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
// DataWarehouseTable is a client component; stub it so this test targets the
// server page's stat/subtitle logic only.
vi.mock("./DataWarehouseTable", () => ({
  DataWarehouseTable: ({ rows }: { rows: unknown[] }) => <div>dw-table:{rows.length}</div>,
}));

import DataWarehousePage from "./page";

function mockDw(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/analytics/data-warehouse")) return Promise.resolve(result);
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("DataWarehousePage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("GAP-ANALYTICS-DATA-WAREHOUSE-02: subtitle no longer promises refresh schedules", async () => {
    mockDw({ data: [], source: "api" });
    render(await DataWarehousePage());
    expect(screen.queryByText(/refresh schedules/i)).not.toBeInTheDocument();
  });

  it("GAP-ANALYTICS-DATA-WAREHOUSE-01: total records is '—' (partial) when a row has a non-numeric count", async () => {
    mockDw({
      data: [
        { dataset: "A", lastRefresh: "", records: "12,48,320", size: "—", qualityScore: "—", status: "Healthy" },
        { dataset: "B", lastRefresh: "", records: "1.2 M", size: "—", qualityScore: "—", status: "Healthy" },
      ],
      source: "api",
    });
    render(await DataWarehousePage());
    // The old code would have shown 1,248,332 — a fabricated total.
    expect(screen.queryByText("12,48,332")).not.toBeInTheDocument();
    expect(screen.getByText("Total Records").closest(".stat")).toHaveTextContent("—");
  });

  it("GAP-ANALYTICS-DATA-WAREHOUSE-03: a lowercase 'healthy' counts as Healthy, not Attention", async () => {
    mockDw({
      data: [
        { dataset: "A", lastRefresh: "", records: "10", size: "—", qualityScore: "—", status: "healthy" },
        { dataset: "B", lastRefresh: "", records: "20", size: "—", qualityScore: "—", status: "Healthy" },
      ],
      source: "api",
    });
    render(await DataWarehousePage());
    expect(screen.getByText("Healthy").closest(".stat")).toHaveTextContent("2");
    expect(screen.getByText("Attention").closest(".stat")).toHaveTextContent("0");
    // clean numeric total sums correctly
    expect(screen.getByText("Total Records").closest(".stat")).toHaveTextContent("30");
  });

  it("GAP2-ANALYTICS-DATA-WAREHOUSE-01: when every row's status is unknown ('—'), Healthy and Attention both show '—'", async () => {
    // The backend no longer stamps a blanket 'Healthy'; it returns '—' when
    // no quality signal exists. Rows with no health signal must count as
    // neither Healthy nor Attention (previously all such rows read as
    // Attention, which is just as misleading as all-Healthy).
    mockDw({
      data: [
        { dataset: "A", lastRefresh: "2023-01-02 03:04", records: "10", size: "—", qualityScore: "—", status: "—" },
        { dataset: "B", lastRefresh: "2023-01-02 03:04", records: "20", size: "—", qualityScore: "—", status: "—" },
      ],
      source: "api",
    });
    render(await DataWarehousePage());
    expect(screen.getByText("Healthy").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Attention").closest(".stat")).toHaveTextContent("—");
  });
});
