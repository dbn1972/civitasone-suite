import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpportunityViews } from "./OpportunityViews";
import * as op from "@/lib/crm/opportunity";

vi.mock("@/lib/crm/opportunity", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/opportunity")>();
  return {
    ...actual,
    getPipelines: vi.fn(),
    getKanban: vi.fn(),
    getFunnel: vi.fn(),
    getOpportunities: vi.fn(),
    getCalendar: vi.fn(),
    changeOpportunityStage: vi.fn(),
  };
});

const pipeline: op.Pipeline = {
  id: "p1",
  name: "Enterprise",
  enabled: true,
  stages: [
    { key: "qual", name: "Qualify", mandatoryFields: [], gate: false },
    { key: "propose", name: "Propose", mandatoryFields: ["value"], gate: false },
  ],
};
const deal: op.Opportunity = {
  id: "d1",
  name: "Datacentre",
  pipelineId: "p1",
  stage: "qual",
  valueMinor: "150000",
  probability: 40,
  product: "Servers",
  quantity: 2,
  competitors: [],
  nextStep: "",
  expectedCloseDate: "2026-09-01",
};

beforeEach(() => {
  vi.mocked(op.getPipelines).mockReset().mockResolvedValue({ data: [pipeline], source: "api" });
  vi.mocked(op.getKanban).mockReset().mockResolvedValue({ data: [{ stage: "qual", stageName: "Qualify", deals: [deal] }], source: "api" });
  vi.mocked(op.getFunnel).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(op.getOpportunities).mockReset().mockResolvedValue({ data: [deal], source: "api" });
  vi.mocked(op.getCalendar).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(op.changeOpportunityStage).mockReset();
});

describe("OpportunityViews (OP-004)", () => {
  it("renders the kanban board with a deal card", async () => {
    render(<OpportunityViews />);
    await waitFor(() => expect(screen.getByText("Datacentre")).toBeInTheDocument());
    expect(screen.getAllByText(/Qualify/).length).toBeGreaterThan(0);
  });

  it("moves a card between stages only after ConfirmDialog confirmation", async () => {
    vi.mocked(op.changeOpportunityStage).mockResolvedValue(undefined);
    render(<OpportunityViews />);
    await waitFor(() => expect(screen.getByText("Datacentre")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/move datacentre to stage/i), { target: { value: "propose" } });
    // confirm dialog appears; nothing called yet
    expect(op.changeOpportunityStage).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
    await waitFor(() => expect(op.changeOpportunityStage).toHaveBeenCalledWith("d1", "propose", undefined));
  });

  it("surfaces a blocked stage move (422 mandatory fields) in the dialog", async () => {
    vi.mocked(op.changeOpportunityStage).mockRejectedValue(new op.MandatoryFieldsError("blocked", ["value"]));
    render(<OpportunityViews />);
    await waitFor(() => expect(screen.getByText("Datacentre")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/move datacentre to stage/i), { target: { value: "propose" } });
    fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
    expect(await screen.findByText(/Propose needs:.*Deal value/i)).toBeInTheDocument();
  });

  it("gates the board on a failed fetch with the saved-info badge", async () => {
    vi.mocked(op.getKanban).mockResolvedValue({ data: [], source: "error" });
    render(<OpportunityViews />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
  });

  it("switches to the list view and can open the close dialog", async () => {
    render(<OpportunityViews />);
    await waitFor(() => expect(screen.getByText("Datacentre")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(await screen.findByRole("button", { name: /close opportunity/i })).toBeInTheDocument();
  });

  it("renders the calendar view by close date", async () => {
    vi.mocked(op.getCalendar).mockResolvedValue({ data: [{ id: "d1", name: "Datacentre", expectedCloseDate: "2026-09-01", valueMinor: "150000", stage: "qual" }], source: "api" });
    render(<OpportunityViews />);
    await waitFor(() => expect(screen.getByText("Datacentre")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    await waitFor(() => expect(screen.getByText(/01\/09\/2026/)).toBeInTheDocument());
  });

  it("renders the funnel view with a meter per stage", async () => {
    vi.mocked(op.getFunnel).mockResolvedValue({ data: [{ stage: "qual", stageName: "Qualify", count: 3, valueMinor: "9900" }], source: "api" });
    render(<OpportunityViews />);
    await waitFor(() => expect(screen.getByText("Datacentre")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Funnel" }));
    await waitFor(() => expect(screen.getByRole("meter")).toBeInTheDocument());
  });
});
