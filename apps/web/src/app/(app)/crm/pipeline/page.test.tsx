import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PipelinePage from "./page";
import { getPipelines, getPipelineDeals } from "../../../_data/loaders";

vi.mock("../../../_data/loaders", () => ({
  getPipelines: vi.fn(),
  getPipelineDeals: vi.fn(),
}));
vi.mock("./_components/KanbanBoard", () => ({
  KanbanBoard: () => <div data-testid="kanban" />,
}));

const MOCK_PIPELINE = [
  { id: "p1", name: "Procurement Pipeline", stages: [], status: "active" as const },
];

const MOCK_DEALS = [
  {
    id: "d1",
    name: "Test Procurement Engagement",
    stageId: "s1",
    stage: "Initial",
    valueMinor: "5000000",
    valueDisplay: "₹50,000",
    probability: 30,
    ownerId: "u1",
    contactName: "Test Officer",
    version: 1,
  },
];

describe("Pipeline Page", () => {
  beforeEach(() => {
    vi.mocked(getPipelines).mockResolvedValue({ data: MOCK_PIPELINE, source: "api" });
    vi.mocked(getPipelineDeals).mockResolvedValue({ data: MOCK_DEALS, source: "api" });
  });

  it("renders 'Engagement Pipeline' heading", async () => {
    render(await PipelinePage());
    expect(
      screen.getByRole("heading", { name: /Engagement Pipeline/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Total Engagements' stat label", async () => {
    render(await PipelinePage());
    expect(screen.getByText("Total Engagements")).toBeInTheDocument();
  });

  it("renders 'Engagement Value' stat label", async () => {
    render(await PipelinePage());
    expect(screen.getByText("Engagement Value")).toBeInTheDocument();
  });

  it("renders 'Avg Likelihood' stat label (not 'Avg Probability')", async () => {
    render(await PipelinePage());
    expect(screen.getByText("Avg Likelihood")).toBeInTheDocument();
    expect(screen.queryByText("Avg Probability")).not.toBeInTheDocument();
  });

  it("renders KanbanBoard component", async () => {
    render(await PipelinePage());
    expect(screen.getByTestId("kanban")).toBeInTheDocument();
  });
});
