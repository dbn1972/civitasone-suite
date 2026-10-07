import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

// The actionable queue is a client component with browser-only hooks; stub it
// so this test exercises only the server page's stats/table.
vi.mock("./ProcurementApprovalsPanel", () => ({
  ProcurementApprovalsPanel: () => <div data-testid="panel" />,
}));

import ApprovalsPage from "./page";

function mockApprovals(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/procurement/approvals")) return Promise.resolve(result);
    return Promise.resolve({ data: [], source: "api" });
  });
}

const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const nextWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

describe("ApprovalsPage stats (GAP-PROCUREMENT-APPROVALS-02/03/04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("GAP-APPROVALS-04: counts overdue by date (dueAt), not by substring-matching the display string", async () => {
    mockApprovals({
      data: [
        // dueDisplay deliberately localised/odd so a substring match would miss it;
        // dueAt is yesterday => overdue.
        { id: "a1", referenceId: "IND-1", owner: "Dept A", dueDisplay: "कल", dueAt: yesterday },
        { id: "a2", referenceId: "PO-1", owner: "Dept B", dueDisplay: "next week", dueAt: nextWeek },
      ],
      source: "api",
    });
    render(await ApprovalsPage());
    // Exactly one overdue (the yesterday one).
    expect(screen.getByText("Due today or overdue").closest(".stat")).toHaveTextContent("1");
  });

  it("GAP-APPROVALS-03: shows '—' for every stat when the load errored", async () => {
    mockApprovals({ data: [], source: "error" });
    render(await ApprovalsPage());
    expect(screen.getByText("Pending Approvals").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Due today or overdue").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Unique Owners").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("With a due date").closest(".stat")).toHaveTextContent("—");
  });

  it("GAP-APPROVALS-02: a valid empty list renders the EmptyState, not an ErrorState", async () => {
    // mapApprovals now returns [] (source 'api') for a genuinely empty list.
    mockApprovals({ data: [], source: "api" });
    render(await ApprovalsPage());
    expect(screen.getByText("No pending approvals")).toBeInTheDocument();
    expect(screen.getByText("Pending Approvals").closest(".stat")).toHaveTextContent("0");
  });

  it("GAP-APPROVALS-02: no two stat cards report the same number (no duplicate 'Action Required')", async () => {
    mockApprovals({
      data: [
        { id: "a1", referenceId: "IND-1", owner: "Dept A", dueDisplay: "—" },
        { id: "a2", referenceId: "PO-1", owner: "Dept A", dueDisplay: "—", dueAt: yesterday },
      ],
      source: "api",
    });
    render(await ApprovalsPage());
    // Pending=2, Overdue=1, UniqueOwners=1, WithDueDate=1 — the labels are
    // distinct and "Action Required" (the old duplicate) is gone.
    expect(screen.queryByText("Action Required")).toBeNull();
    expect(screen.getByText("Pending Approvals").closest(".stat")).toHaveTextContent("2");
    expect(screen.getByText("With a due date").closest(".stat")).toHaveTextContent("1");
  });

  it("GAP-APPROVALS-04: the raw internal Approval ID column is dropped", async () => {
    mockApprovals({
      data: [{ id: "uuid-internal-123", referenceId: "IND-99", owner: "Dept A", dueDisplay: "—" }],
      source: "api",
    });
    render(await ApprovalsPage());
    expect(screen.queryByText("Approval ID")).toBeNull();
    expect(screen.getByText("IND-99")).toBeInTheDocument();
    expect(screen.queryByText("uuid-internal-123")).toBeNull();
  });
});

describe("mapApprovals empty-list behaviour (GAP-PROCUREMENT-APPROVALS-02)", () => {
  it("maps a valid empty list to [] (api) and a non-array payload to null (error)", async () => {
    const { getProcurementApprovals } = await import("@/app/_data/loaders");
    let captured: { mapResponse: (p: unknown) => unknown } | undefined;
    fetchJsonMock.mockImplementation((_path: unknown, _empty: unknown, options: { mapResponse: (p: unknown) => unknown }) => {
      captured = options;
      return Promise.resolve({ data: [], source: "api" });
    });
    await getProcurementApprovals();
    expect(captured).toBeDefined();
    // Valid empty list -> [] (NOT null): fetchJson keeps source 'api'.
    expect(captured!.mapResponse({ data: [] })).toEqual([]);
    expect(captured!.mapResponse([])).toEqual([]);
    // Unreadable payload -> null: fetchJson flips to source 'error'.
    expect(captured!.mapResponse({ nope: true })).toBeNull();
    expect(captured!.mapResponse("garbage")).toBeNull();
  });
});
