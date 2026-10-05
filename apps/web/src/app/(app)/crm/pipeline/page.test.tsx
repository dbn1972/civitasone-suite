import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PipelinePage from "./page";
import { getPipelines, getPipelineDeals } from "../../../_data/loaders";

vi.mock("../../../_data/loaders", () => ({
  getPipelines: vi.fn(),
  getPipelineDeals: vi.fn(),
  // GAP-CRM-PIPELINE-05: the page reads this limit to decide whether to warn
  // about truncation; keep the mock's value in sync with the real export.
  PIPELINE_DEAL_LIMIT: 200,
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
    render(await PipelinePage({}));
    expect(
      screen.getByRole("heading", { name: /Engagement Pipeline/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Total Engagements' stat label", async () => {
    render(await PipelinePage({}));
    expect(screen.getByText("Total Engagements")).toBeInTheDocument();
  });

  it("renders 'Engagement Value' stat label", async () => {
    render(await PipelinePage({}));
    expect(screen.getByText("Engagement Value")).toBeInTheDocument();
  });

  it("renders 'Avg Likelihood' stat label (not 'Avg Probability')", async () => {
    render(await PipelinePage({}));
    expect(screen.getByText("Avg Likelihood")).toBeInTheDocument();
    expect(screen.queryByText("Avg Probability")).not.toBeInTheDocument();
  });

  it("renders KanbanBoard component", async () => {
    render(await PipelinePage({}));
    expect(screen.getByTestId("kanban")).toBeInTheDocument();
  });

  // GAP-CRM-PIPELINE-01: on a failed load the StatCards must show "—", never fabricated
  // 0 / ₹0.00 / 0% figures that read as a real (empty) pipeline.
  it("shows '—' stat values on a failed load, not zeros", async () => {
    vi.mocked(getPipelineDeals).mockResolvedValue({ data: [], source: "error" });
    render(await PipelinePage({}));
    // Four stat cards, all em-dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  // GAP-CRM-PIPELINE-03: the High-Value tile states its threshold (₹1 crore) in the
  // label — never an unlabelled magic number — and counts only deals at/above it.
  it("labels the High-Value tile with the ₹1 crore threshold and counts above it", async () => {
    vi.mocked(getPipelineDeals).mockResolvedValue({
      data: [
        // ₹99,99,999.99 = 999999999 paise -> below ₹1 crore (1,000,000,000 paise)
        { ...MOCK_DEALS[0], id: "below", valueMinor: "999999999" },
        // exactly ₹1 crore -> counts
        { ...MOCK_DEALS[0], id: "at", valueMinor: "1000000000" },
      ],
      source: "api",
    });
    render(await PipelinePage({}));
    expect(screen.getByText(/High-Value Engagements \(≥ ₹1,00,00,000\.00\)/)).toBeInTheDocument();
    // Exactly one deal is at/above the threshold.
    const tile = screen.getByText(/High-Value Engagements/).closest("*")!;
    expect(tile.parentElement!.textContent).toContain("1");
  });

  // GAP-CRM-PIPELINE-05: when exactly the fetch limit comes back, warn that the board
  // and the figures may be incomplete rather than presenting a capped total as whole.
  it("warns about truncation when the deal count hits the fetch limit", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...MOCK_DEALS[0], id: `d${i}` }));
    vi.mocked(getPipelineDeals).mockResolvedValue({ data: many, source: "api" });
    render(await PipelinePage({}));
    expect(screen.getByText(/Showing the first 200 engagements/i)).toBeInTheDocument();
  });

  it("shows no truncation warning when below the fetch limit", async () => {
    render(await PipelinePage({}));
    expect(screen.queryByText(/Showing the first 200 engagements/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-PIPELINE-05 (wave2): with a real server total greater than the loaded
  // page, the banner shows an exact "Showing N of M engagements".
  it("shows an exact 'N of M' when the backend returns pagination.total", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...MOCK_DEALS[0], id: `d${i}` }));
    vi.mocked(getPipelineDeals).mockResolvedValue({ data: many, source: "api", total: 512 } as never);
    render(await PipelinePage({}));
    expect(screen.getByText(/Showing 200 of 512 engagements/i)).toBeInTheDocument();
  });

  // GAP-CRM-PIPELINE-04: no "deal"/"Deal" user-visible vocabulary leaks into the
  // pipeline screen's stat labels — they are all "Engagement".
  it("uses 'Engagement' vocabulary in stat labels, not 'Deal'", async () => {
    render(await PipelinePage({}));
    expect(screen.getByText("Total Engagements")).toBeInTheDocument();
    expect(screen.queryByText(/Total Deals/i)).not.toBeInTheDocument();
  });
});
