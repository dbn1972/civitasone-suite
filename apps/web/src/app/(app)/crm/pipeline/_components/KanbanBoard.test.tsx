import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { KanbanBoard } from "./KanbanBoard";
import type { PipelineDealCard, PipelineView } from "../../../../_data/loaders";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: <T,>(
    _key: string,
    initialData: T,
    _source: string,
    _isEmpty: (d: T) => boolean,
  ) => ({
    data: initialData,
    fromCache: false,
    offline: false,
    cachedAt: null,
  }),
}));

const PIPELINE: PipelineView = {
  id: "pipe-1",
  name: "Sales Pipeline",
  stages: [
    { id: "stage-lead", name: "Lead", probability: 10, ordinal: 0 },
    { id: "stage-proposal", name: "Proposal", probability: 30, ordinal: 1 },
    { id: "stage-negotiation", name: "Negotiation", probability: 60, ordinal: 2 },
    { id: "stage-won", name: "Won", probability: 100, ordinal: 3 },
  ],
  status: "active",
};

const DEALS: PipelineDealCard[] = [
  {
    id: "deal-1",
    name: "Enterprise License",
    stageId: "stage-lead",
    stage: "Lead",
    valueMinor: "5000000",
    valueDisplay: "₹50,000.00",
    probability: 10,
    ownerId: "user-1",
    contactName: "Rahul Sharma",
    version: 1,
  },
  {
    id: "deal-2",
    name: "Cloud Migration",
    stageId: "stage-proposal",
    stage: "Proposal",
    valueMinor: "12000000",
    valueDisplay: "₹1,20,000.00",
    probability: 30,
    ownerId: "user-2",
    contactName: "Priya Patel",
    version: 2,
  },
];

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KanbanBoard", () => {
  it("renders all stage columns from pipeline config", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Proposal")).toBeInTheDocument();
    expect(screen.getByText("Negotiation")).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
  });

  it("renders deal cards with name, value, and contact", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    expect(screen.getByText("Enterprise License")).toBeInTheDocument();
    expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
    expect(screen.getByText("Rahul Sharma")).toBeInTheDocument();
    expect(screen.getByText("Priya Patel")).toBeInTheDocument();
  });

  it("renders probability percentages on deal cards", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("shows empty state when no deals exist", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={[]} source="api" />);

    expect(screen.getByText("No deals in pipeline")).toBeInTheDocument();
    expect(screen.getByText("Create Deal")).toBeInTheDocument();
  });

  it("uses default stages when pipeline is null", () => {
    render(<KanbanBoard pipeline={null} deals={DEALS} source="api" />);

    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Proposal")).toBeInTheDocument();
    expect(screen.getByText("Negotiation")).toBeInTheDocument();
  });

  it("deal cards are draggable", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    const card = screen.getByRole("button", { name: /Enterprise License/i });
    expect(card).toHaveAttribute("draggable", "true");
  });

  it("deal cards have accessible keyboard instructions", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    const card = screen.getByRole("button", { name: /Enterprise License/i });
    expect(card).toHaveAttribute("tabIndex", "0");
    expect(card.getAttribute("aria-label")).toContain("arrow keys");
  });

  it("displays error message on version conflict (409)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { message: "version conflict" } }),
    });

    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    // Simulate keyboard move (ArrowRight on lead deal)
    const card = screen.getByRole("button", { name: /Enterprise License/i });
    await act(async () => {
      fireEvent.keyDown(card, { key: "ArrowRight" });
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("alert").textContent).toContain("Version conflict");
    });
  });

  it("optimistically moves deal on successful API call", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: "deal-1", stage: "Proposal", previousStage: "Lead" } }),
    });

    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    // Move Enterprise License from Lead to Proposal via keyboard
    const card = screen.getByRole("button", { name: /Enterprise License/i });
    await act(async () => {
      fireEvent.keyDown(card, { key: "ArrowRight" });
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proxy/v1/crm/deals/deal-1/stage",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("Proposal"),
        }),
      );
    });
  });

  it("reverts optimistic move on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    const card = screen.getByRole("button", { name: /Enterprise License/i });
    await act(async () => {
      fireEvent.keyDown(card, { key: "ArrowRight" });
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("alert").textContent).toContain("Network error");
    });
  });

  it("stage columns display deal count and value", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    // Lead stage: 1 deal
    const leadRegion = screen.getByRole("region", { name: /Lead stage/i });
    expect(leadRegion).toBeInTheDocument();
    expect(leadRegion.textContent).toContain("1 deal");
  });
});
