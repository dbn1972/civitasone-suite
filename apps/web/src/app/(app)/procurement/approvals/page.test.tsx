import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["procurement_admin"] }));

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

// D4c #17 (owner decision 2026-10-27): the workflow queue is the single source of
// truth for action AND the stat tiles (they live in ProcurementApprovalsPanel and are
// tested there). This server page now only renders the read-only register as a
// secondary list, so it must not present competing figures of its own.
describe("ApprovalsPage register is secondary and read-only (D4c #17)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders the panel (queue + figures) and no register-derived stat tiles", async () => {
    mockApprovals({
      data: [{ id: "a1", referenceId: "IND-1", owner: "Dept A", dueDisplay: "—", dueAt: yesterday }],
      source: "api",
    });
    const { container } = render(await ApprovalsPage());
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(container.querySelectorAll(".stat")).toHaveLength(0);
    for (const gone of ["Pending Approvals", "Due today or overdue", "Unique Owners", "With a due date", "Action Required"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("the queue comes first and the register is labelled read-only / reference only", async () => {
    mockApprovals({ data: [{ id: "a1", referenceId: "IND-1", owner: "Dept A", dueDisplay: "—" }], source: "api" });
    render(await ApprovalsPage());
    const panel = screen.getByTestId("panel");
    const register = screen.getByText(/Register of pending indents and draft POs \(read-only\)/);
    expect(panel.compareDocumentPosition(register) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/decided in the workflow queue above, never from this list/)).toBeInTheDocument();
  });

  it("a failed register load shows an error state (not 'No pending approvals') without hiding the queue", async () => {
    mockApprovals({ data: [], source: "error" });
    render(await ApprovalsPage());
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(screen.queryByText("No pending approvals")).toBeNull();
  });

  it("GAP-APPROVALS-02: a valid empty list renders the EmptyState, not an ErrorState", async () => {
    // mapApprovals returns [] (source 'api') for a genuinely empty list.
    mockApprovals({ data: [], source: "api" });
    render(await ApprovalsPage());
    expect(screen.getByText("No pending approvals")).toBeInTheDocument();
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

  it("GAP-APPROVALS-04: the register's Reference is a link to the indent / PO it names", async () => {
    mockApprovals({
      data: [
        { id: "ind-uuid-1", refType: "procurement_indent", referenceId: "IND-1", owner: "Dept A", dueDisplay: "—" },
        { id: "po-uuid-1", refType: "procurement_po", referenceId: "PO-1", owner: "Dept B", dueDisplay: "—" },
        { id: "x-1", referenceId: "LEGACY-1", owner: "Dept C", dueDisplay: "—" },
      ],
      source: "api",
    });
    render(await ApprovalsPage());
    expect(screen.getByRole("link", { name: "IND-1" })).toHaveAttribute("href", "/procurement/indents/ind-uuid-1");
    expect(screen.getByRole("link", { name: "PO-1" })).toHaveAttribute("href", "/procurement/orders/po-uuid-1");
    // A row whose kind is unknown stays plain text rather than linking somewhere wrong.
    expect(screen.getByText("LEGACY-1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "LEGACY-1" })).toBeNull();
  });
});
