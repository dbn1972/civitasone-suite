import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const getDesignerDefinitionsMock = vi.fn();
vi.mock("../designer/_data/designerData", () => ({
  getDesignerDefinitions: (...args: unknown[]) => getDesignerDefinitionsMock(...args),
}));

import WorkflowDefinitionsPage from "./page";

const MOCK_DEFINITIONS = [
  { id: "d1", name: "Leave Approval", module: "hr", triggerEvent: "leave.requested", status: "active" },
];
const MOCK_TEMPLATES = [{ id: "t1", name: "Bill Approval", module: "finance", steps: 2 }];

function mockFetchJson(defsResult: { data: unknown; source: "api" | "error" }, tplResult: { data: unknown; source: "api" | "error" } = { data: [], source: "api" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path !== "string") return Promise.resolve({ data: [], source: "api" });
    if (path.includes("/workflow/definitions")) return Promise.resolve(defsResult);
    if (path.includes("/workflow/templates")) return Promise.resolve(tplResult);
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("WorkflowDefinitionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getDesignerDefinitionsMock.mockReset();
    getDesignerDefinitionsMock.mockResolvedValue({ data: [], source: "api" });
  });

  it("renders workflows and real stat counts on success", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: MOCK_TEMPLATES, source: "api" });
    render(await WorkflowDefinitionsPage());
    expect(screen.getByText("Leave Approval")).toBeInTheDocument();
  });

  // GAP-WORKFLOW-DEFINITIONS-01 / GAP2-WORKFLOW-DEFINITIONS-02 — the page must
  // offer a way to start authoring. The label is now "Design new workflow" so it
  // no longer implies the designer feeds this executable list (the designer
  // saves to a separate designer_definitions table; see the Drafts section).
  it("renders a 'Design new workflow' action linking to the designer", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: MOCK_TEMPLATES, source: "api" });
    render(await WorkflowDefinitionsPage());
    const link = screen.getByRole("link", { name: "Design new workflow" });
    expect(link).toHaveAttribute("href", "/workflow/designer");
  });

  // GAP-WORKFLOW-DEFINITIONS-01 — each template row offers a working clone action.
  it("renders a 'Use template' action per template row", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: MOCK_TEMPLATES, source: "api" });
    render(await WorkflowDefinitionsPage());
    expect(screen.getByRole("button", { name: "Use template" })).toBeInTheDocument();
  });

  // GAP-WORKFLOW-DEFINITIONS-02 — the blank Module/Trigger columns are gone.
  it("does not render the permanently-blank Module/Trigger columns", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: MOCK_TEMPLATES, source: "api" });
    render(await WorkflowDefinitionsPage());
    expect(screen.queryByRole("columnheader", { name: "Trigger" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Code" }).length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when the tenant genuinely has no workflows (both calls succeed, empty)", async () => {
    mockFetchJson({ data: [], source: "api" }, { data: [], source: "api" });
    render(await WorkflowDefinitionsPage());
    expect(screen.getByText("No approval workflows configured")).toBeInTheDocument();
  });

  // UX-001's named bug: getDefinitions()/getTemplates() used to return only
  // `r.data`, discarding `source` entirely, so this exact scenario (the
  // definitions call failing) rendered as "No approval workflows configured"
  // — indistinguishable from a tenant that has genuinely never set one up.
  it("shows the error state — not the empty-state prompt — when the definitions fetch fails", async () => {
    mockFetchJson({ data: [], source: "error" }, { data: [], source: "api" });
    render(await WorkflowDefinitionsPage());
    expect(screen.getByText("We couldn't load approval workflows.")).toBeInTheDocument();
    expect(screen.queryByText("No approval workflows configured")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the error state when only the templates fetch fails, even though definitions succeeded", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: [], source: "error" });
    render(await WorkflowDefinitionsPage());
    expect(screen.getByText("We couldn't load approval workflows.")).toBeInTheDocument();
    expect(screen.queryByText("Leave Approval")).not.toBeInTheDocument();
  });

  // GAP2-WORKFLOW-DEFINITIONS-02 — designer drafts (separate table) appear in
  // their own section so the "Design new workflow" affordance has a visible
  // result and the two tables' distinct nature is explicit.
  it("lists designer drafts in a dedicated section linking back to the designer", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: MOCK_TEMPLATES, source: "api" });
    getDesignerDefinitionsMock.mockResolvedValue({
      data: [{ id: "dr1", name: "Draft WF", description: null, status: "draft", version: 1, elementCount: 3, edgeCount: 2, createdAt: "", updatedAt: "" }],
      source: "api",
    });
    render(await WorkflowDefinitionsPage());
    expect(screen.getByText("Designer drafts (not yet executable)")).toBeInTheDocument();
    const draftLink = screen.getByRole("link", { name: "Open Draft WF" });
    expect(draftLink).toHaveAttribute("href", "/workflow/designer?definitionId=dr1");
  });

  it("does not render the drafts section when there are no designer drafts", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: MOCK_TEMPLATES, source: "api" });
    getDesignerDefinitionsMock.mockResolvedValue({ data: [], source: "api" });
    render(await WorkflowDefinitionsPage());
    expect(screen.queryByText("Designer drafts (not yet executable)")).not.toBeInTheDocument();
  });

  // GAP2-WORKFLOW-DEFINITIONS-03 — the Active tile counts the authoritative
  // live status ("active") and must NOT be understated by relying on a phantom
  // "deployed" literal. A mix of active + draft + archived counts only active.
  it("counts only live-status definitions in the Active tile", async () => {
    const defs = [
      { id: "a1", name: "Alpha", code: "ALPHA", version: 1, status: "active" },
      { id: "a2", name: "Beta", code: "BETA", version: 1, status: "active" },
      { id: "d1", name: "Gamma", code: "GAMMA", version: 1, status: "draft" },
      { id: "ar1", name: "Delta", code: "DELTA", version: 1, status: "archived" },
    ];
    mockFetchJson({ data: defs, source: "api" }, { data: [], source: "api" });
    const { container } = render(await WorkflowDefinitionsPage());
    const tiles = Array.from(container.querySelectorAll(".stat"));
    const activeTile = tiles.find((t) => t.querySelector(".lab")?.textContent === "Active");
    expect(activeTile?.querySelector(".val")?.textContent).toBe("2");
  });
});
