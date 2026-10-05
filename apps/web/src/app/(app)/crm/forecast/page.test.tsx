import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({
  getCrmForecast: vi.fn(),
  getPipelines: vi.fn(),
}));
vi.mock("./PipelineFilter", () => ({
  PipelineFilter: () => <div data-testid="pipeline-filter" />,
}));
vi.mock("./PeriodFilter", () => ({
  PeriodFilter: () => <div data-testid="period-filter" />,
}));
vi.mock("./StageBreakdownTable", () => ({
  StageBreakdownTable: () => <div data-testid="stage-table" />,
}));

import ForecastPage from "./page";
import { getCrmForecast, getPipelines } from "../../../_data/loaders";

const mockedForecast = vi.mocked(getCrmForecast);
const mockedPipelines = vi.mocked(getPipelines);

const mockForecastData = {
  data: {
    totalForecastMinor: "50000000",
    dealCount: 5,
    stages: [],
  },
  source: "api" as const,
};

const mockPipelinesData = {
  data: [{ id: "p1", name: "Test Pipeline", stages: [], status: "active" }],
  source: "api" as const,
};

beforeEach(() => {
  mockedForecast.mockReset();
  mockedPipelines.mockReset();
  mockedForecast.mockResolvedValue(mockForecastData);
  mockedPipelines.mockResolvedValue(mockPipelinesData);
});

describe("ForecastPage — GoI redesign", () => {
  it("renders Procurement Pipeline Forecast heading", async () => {
    render(await ForecastPage({}));
    expect(
      screen.getByText("Procurement Pipeline Forecast"),
    ).toBeInTheDocument();
  });

  it("renders Engagements in Forecast stat label (not Deals in Forecast)", async () => {
    render(await ForecastPage({}));
    expect(screen.getByText("Engagements in Forecast")).toBeInTheDocument();
    expect(screen.queryByText("Deals in Forecast")).not.toBeInTheDocument();
  });

  it("renders Avg Weighted Engagement stat label (not Avg Weighted Deal)", async () => {
    render(await ForecastPage({}));
    expect(screen.getByText("Avg Weighted Engagement")).toBeInTheDocument();
    expect(screen.queryByText("Avg Weighted Deal")).not.toBeInTheDocument();
  });

  it("renders Top Stage label (not Biggest Contributor)", async () => {
    render(await ForecastPage({}));
    expect(screen.getByText("Top Stage")).toBeInTheDocument();
    expect(screen.queryByText("Biggest Contributor")).not.toBeInTheDocument();
  });

  it("renders stage breakdown table", async () => {
    render(await ForecastPage({}));
    expect(screen.getByTestId("stage-table")).toBeInTheDocument();
  });

  it("renders pipeline filter", async () => {
    render(await ForecastPage({}));
    expect(screen.getByTestId("pipeline-filter")).toBeInTheDocument();
  });

  // GAP-CRM-FORECAST-01: a failed forecast load must NOT render ₹0.00 tiles / "No
  // forecast yet"; it shows an error state and omits the money tiles.
  it("shows an error state (no ₹0.00 tiles) when the forecast fetch fails", async () => {
    mockedForecast.mockResolvedValue({
      data: { totalForecastMinor: "0", dealCount: 0, stages: [] },
      source: "error" as const,
      status: 500,
    } as never);
    render(await ForecastPage({}));
    expect(screen.queryByText("Weighted Forecast")).not.toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-table")).not.toBeInTheDocument();
  });

  // GAP-CRM-FORECAST-03: a chosen FY quarter is resolved to a close-date window
  // passed to the loader, and named in the subtitle.
  it("passes the period's close-date window to the loader and names it in the subtitle", async () => {
    render(await ForecastPage({ searchParams: { period: "fy2026-q2" } }));
    expect(mockedForecast).toHaveBeenCalledWith(
      undefined,
      { closeDateFrom: "2026-07-01", closeDateTo: "2026-09-30" },
    );
    expect(screen.getByText(/Q2 \(Jul–Sep\)/)).toBeInTheDocument();
  });

  it("renders the period filter", async () => {
    render(await ForecastPage({}));
    expect(screen.getByTestId("period-filter")).toBeInTheDocument();
  });
});
