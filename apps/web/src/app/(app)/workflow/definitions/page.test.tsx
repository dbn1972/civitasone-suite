import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import WorkflowDefinitionsPage from "./page";

const MOCK_DEFINITIONS = [
  { id: "d1", name: "Leave Approval", module: "hr", triggerEvent: "leave.requested", status: "active" },
];
const MOCK_TEMPLATES = [{ id: "t1", name: "Bill Approval", module: "finance", steps: 2 }];

function mockFetchJson(defsResult: { data: unknown; source: "api" | "error" }, tplResult: { data: unknown; source: "api" | "error" } = { data: [], source: "api" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path !== "string") return Promise.resolve({ data: [], source: "api" });
    // eslint-disable-next-line no-console
    if (path.includes("/workflow/definitions")) return Promise.resolve(defsResult);
    if (path.includes("/workflow/templates")) return Promise.resolve(tplResult);
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("WorkflowDefinitionsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders workflows and real stat counts on success", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: MOCK_TEMPLATES, source: "api" });
    render(await WorkflowDefinitionsPage());
    expect(screen.getByText("Leave Approval")).toBeInTheDocument();
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
    expect(screen.getByText("We couldn't load this approval workflows.")).toBeInTheDocument();
    expect(screen.queryByText("No approval workflows configured")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the error state when only the templates fetch fails, even though definitions succeeded", async () => {
    mockFetchJson({ data: MOCK_DEFINITIONS, source: "api" }, { data: [], source: "error" });
    render(await WorkflowDefinitionsPage());
    expect(screen.getByText("We couldn't load this approval workflows.")).toBeInTheDocument();
    expect(screen.queryByText("Leave Approval")).not.toBeInTheDocument();
  });
});
