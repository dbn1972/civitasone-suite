import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({
  getCrmForecast: vi.fn(),
  getPipelines: vi.fn(),
}));
vi.mock("./PipelineFilter", () => ({
  PipelineFilter: () => <div data-testid="pipeline-filter" />,
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
});
