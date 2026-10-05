import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { KanbanBoard } from "./KanbanBoard";
import type { PipelineDealCard, PipelineView } from "../../../../_data/loaders";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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

    // GAP-CRM-PIPELINE-04: empty-state copy uses "Engagement" vocabulary.
    expect(screen.getByText("No engagements in pipeline")).toBeInTheDocument();
    expect(screen.getByText("New Engagement")).toBeInTheDocument();
  });

  // GAP-CRM-PIPELINE-01: on a failed load with nothing cached, the board must NOT read
  // as the empty state (which fabricates empty as fact) — it shows an error state with
  // Retry instead.
  it("shows an error state, not the empty state, when source='error' and no deals", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={[]} source="error" />);

    expect(screen.queryByText("No engagements in pipeline")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New Engagement" })).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
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
    // GAP-CRM-PIPELINE-02: the move is confirmed first — click Move to commit.
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
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
    // No PATCH yet — the dialog is open and awaiting confirmation.
    expect(global.fetch).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
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

  // UX-016: the generic (non-409) failure branch used to echo the backend's
  // raw `error.message` field (or a bare `Server error (${status})`
  // fallback) verbatim. It must now show only the catalogued, clerk-safe
  // copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, on a generic (non-409) move failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "deal_service unavailable: connection refused" } }),
    });

    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    const card = screen.getByRole("button", { name: /Enterprise License/i });
    await act(async () => {
      fireEvent.keyDown(card, { key: "ArrowRight" });
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("alert").textContent).toMatch(/couldn't save/i);
    });
    expect(screen.queryByText(/deal_service unavailable/)).not.toBeInTheDocument();
  });

  it("reverts optimistic move on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    const card = screen.getByRole("button", { name: /Enterprise License/i });
    await act(async () => {
      fireEvent.keyDown(card, { key: "ArrowRight" });
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("alert").textContent).toContain("Network error");
    });
  });

  // GAP-CRM-PIPELINE-02: a move must open a confirm dialog and issue NO PATCH until the
  // user confirms; cancelling leaves the card where it was.
  it("opens a confirm dialog on move and issues no PATCH until confirmed", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);
    const card = screen.getByRole("button", { name: /Enterprise License/i });
    await act(async () => {
      fireEvent.keyDown(card, { key: "ArrowRight" });
    });

    // Dialog is open, nothing sent.
    expect(await screen.findByRole("button", { name: /^move$/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Cancel leaves the card in place and still issues no PATCH.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
    // The card is still under the Lead column (unmoved).
    const leadRegion = screen.getByRole("region", { name: /Lead stage/i });
    expect(leadRegion.textContent).toContain("Enterprise License");
  });

  // A deal that already has its own probability (45) must keep it when moved to a stage
  // with a different default (30) UNLESS the user ticks the "use stage default" box — so
  // the PATCH omits `probability` by default.
  it("does not overwrite a deal's probability with the stage default unless the user opts in", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchSpy;

    const dealWithProb: PipelineDealCard[] = [
      { ...DEALS[0], probability: 45 },
    ];
    render(<KanbanBoard pipeline={PIPELINE} deals={dealWithProb} source="api" />);
    const card = screen.getByRole("button", { name: /Enterprise License/i });
    await act(async () => {
      fireEvent.keyDown(card, { key: "ArrowRight" }); // Lead(10) -> Proposal(30)
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stage).toBe("Proposal");
    // probability is NOT sent — the deal keeps its own 45.
    expect(body.probability).toBeUndefined();
  });

  it("sends the stage default probability when the user opts in", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchSpy;

    const dealWithProb: PipelineDealCard[] = [{ ...DEALS[0], probability: 45 }];
    render(<KanbanBoard pipeline={PIPELINE} deals={dealWithProb} source="api" />);
    const card = screen.getByRole("button", { name: /Enterprise License/i });
    await act(async () => {
      fireEvent.keyDown(card, { key: "ArrowRight" }); // -> Proposal(30)
    });
    // Tick the "replace likelihood" checkbox, then confirm.
    fireEvent.click(await screen.findByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^move$/i }));
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.probability).toBe(30);
  });

  it("stage columns display deal count and value", () => {
    render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);

    // Lead stage: 1 deal
    const leadRegion = screen.getByRole("region", { name: /Lead stage/i });
    expect(leadRegion).toBeInTheDocument();
    expect(leadRegion.textContent).toMatch(/1 (deal|engagement)/);
  });

  // GAP-CRM-OPPORTUNITIES-02: the pipeline board now offers a pipeline picker
  // (parity with the opportunities board) when more than one pipeline exists.
  // Selecting another pipeline swaps the visible stage columns.
  it("offers a pipeline picker and switches stage columns on change", () => {
    const second: PipelineView = {
      id: "pipe-2",
      name: "Govt Pipeline",
      stages: [
        { id: "g-intake", name: "Intake", probability: 20, ordinal: 0 },
        { id: "g-tender", name: "Tender", probability: 50, ordinal: 1 },
      ],
      status: "active",
    };
    render(<KanbanBoard pipeline={PIPELINE} pipelines={[PIPELINE, second]} deals={DEALS} source="api" />);

    const picker = screen.getByLabelText("Pipeline") as HTMLSelectElement;
    expect(picker).toBeInTheDocument();
    // Default pipeline's stages are shown.
    expect(screen.getByText("Proposal")).toBeInTheDocument();
    // Switch to the second pipeline — its stages replace the columns.
    fireEvent.change(picker, { target: { value: "pipe-2" } });
    expect(screen.getByText("Intake")).toBeInTheDocument();
    expect(screen.getByText("Tender")).toBeInTheDocument();
    expect(screen.queryByText("Proposal")).not.toBeInTheDocument();
  });

  it("hides the pipeline picker when only one pipeline exists", () => {
    render(<KanbanBoard pipeline={PIPELINE} pipelines={[PIPELINE]} deals={DEALS} source="api" />);
    expect(screen.queryByLabelText("Pipeline")).not.toBeInTheDocument();
  });

  // GAP-CRM-OPPORTUNITIES-02: both boards go through one client function, so a
  // Kanban move sends the same route, verb and payload keys as the list view's
  // changeOpportunityStage for the same move.
  describe("one stage-move contract with the opportunity list (GAP-CRM-OPPORTUNITIES-02)", () => {
    function okResponse() {
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }

    it("sends the same PATCH as changeOpportunityStage for the same move", async () => {
      const { changeOpportunityStage } = await import("@/lib/crm/opportunity");
      const fetchSpy = vi.fn().mockImplementation(async () => okResponse());
      global.fetch = fetchSpy;

      // List-view path (OpportunityViews passes the stage name + stage id).
      await changeOpportunityStage("deal-1", "Proposal", 1, "stage-proposal");
      // Kanban path — deal-1 already has its own probability (10), so none is sent.
      render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("button", { name: /Enterprise License/i }), { key: "ArrowRight" });
      });
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
      });
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

      const [listUrl, listInit] = fetchSpy.mock.calls[0];
      const [boardUrl, boardInit] = fetchSpy.mock.calls[1];
      expect(boardUrl).toBe(listUrl);
      expect(boardUrl).toBe("/api/proxy/v1/crm/deals/deal-1/stage");
      expect((boardInit as RequestInit).method).toBe((listInit as RequestInit).method);
      expect(JSON.parse((boardInit as RequestInit).body as string)).toEqual(
        JSON.parse((listInit as RequestInit).body as string),
      );
    });

    it("names the missing mandatory fields when the stage gate rejects a drag move (422)", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "MANDATORY_STAGE_FIELDS_MISSING", missingFields: ["closeDate", "valueMinor"] }),
          { status: 422 },
        ),
      );
      render(<KanbanBoard pipeline={PIPELINE} deals={DEALS} source="api" />);
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("button", { name: /Enterprise License/i }), { key: "ArrowRight" });
      });
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: /^move$/i }));
      });
      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toMatch(/needs more information/i);
        expect(alert.textContent).toContain("closeDate");
        expect(alert.textContent).toContain("valueMinor");
      });
    });
  });
});
