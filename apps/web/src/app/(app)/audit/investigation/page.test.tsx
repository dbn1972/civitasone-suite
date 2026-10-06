import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

let sessionRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => sessionRoles };
});

import InvestigationPage from "./page";

const MOCK_ROWS = [{ id: "i1", status: "in_progress" }];

describe("InvestigationPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); sessionRoles = []; });

  it("renders investigations and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await InvestigationPage());
    expect(screen.getAllByText("Active Investigations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no investigations", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await InvestigationPage());
    expect(screen.getByText("No investigations found")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await InvestigationPage());
    expect(screen.getByText("We couldn't load investigation cases.")).toBeInTheDocument();
    expect(screen.queryByText("No investigations found")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  // Redaction must happen on the server: the rows handed to the client
  // component (RSC payload) must not carry raw subject/findings.
  it("does not ship raw subject/findings to a role outside the detail set", async () => {
    sessionRoles = ["finance_admin"];
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "i1", caseId: "INV-1", subject: "SECRET-SUBJECT-TEXT", findings: "SECRET-FINDINGS-TEXT", assignedTo: "x", started: "2026-01-01", status: "in_progress" }],
      source: "api",
    });
    const tree = await InvestigationPage();
    const { container } = render(tree);
    expect(JSON.stringify(tree, (_k, v) => (typeof v === "function" ? undefined : v))).not.toContain("SECRET-");
    expect(container.innerHTML).not.toContain("SECRET-");
  });

  it("passes raw subject/findings through for an audit role", async () => {
    sessionRoles = ["audit_officer"];
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "i1", caseId: "INV-1", subject: "SECRET-SUBJECT-TEXT", findings: "SECRET-FINDINGS-TEXT", assignedTo: "x", started: "2026-01-01", status: "in_progress" }],
      source: "api",
    });
    const { container } = render(await InvestigationPage());
    expect(container.innerHTML).toContain("SECRET-SUBJECT-TEXT");
  });
});
