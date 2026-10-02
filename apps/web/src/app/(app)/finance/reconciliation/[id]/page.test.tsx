import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const rolesMock = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

import ReconciliationRunDetailPage from "./page";

const RUN = {
  id: "11111111-1111-1111-1111-111111111111",
  provider: "book-vs-bank",
  sourceSystem: "finance-book",
  targetSystem: "bank-statement",
  status: "completed",
  sourceCount: 100,
  targetCount: 98,
  matchedCount: 95,
  breakCount: 1,
  balanced: false,
  startedAt: "2026-07-01T00:00:00.000Z",
  completedAt: "2026-07-01T00:05:00.000Z",
};

const EXCEPTION = {
  id: "22222222-2222-2222-2222-222222222222",
  runId: RUN.id,
  provider: "book-vs-bank",
  breakKey: "UTR12345",
  breakType: "value_mismatch",
  field: "amountMinor",
  fieldType: "amount",
  sourceValue: "100000",
  targetValue: "99000",
  deltaMinor: "-1000",
  severity: "high",
  status: "open",
  resolutionNote: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("ReconciliationRunDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset().mockReturnValue([]);
  });

  it("renders the run and its exceptions", async () => {
    fetchJsonMock.mockResolvedValue({ data: { data: RUN, breaks: [EXCEPTION] }, source: "api" });

    const ui = await ReconciliationRunDetailPage({ params: { id: RUN.id } });
    render(ui);

    expect(screen.getByText(/Recon Run — book-vs-bank/)).toBeInTheDocument();
    expect(screen.getByText("UTR12345")).toBeInTheDocument();
  });

  // GAP-FINANCE-RECONCILIATION-DETAIL-03: failure vs not-found are told apart by status.
  it("shows a retryable error state (not not-found) on a 500", async () => {
    fetchJsonMock.mockResolvedValue({ data: { data: null, breaks: [] }, source: "error", status: 500 });
    render(await ReconciliationRunDetailPage({ params: { id: RUN.id } }));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Run not found")).not.toBeInTheDocument();
  });

  it("shows 'Run not found' inside the page chrome (header + back link) on a 404", async () => {
    fetchJsonMock.mockResolvedValue({ data: { data: null, breaks: [] }, source: "error", status: 404 });
    render(await ReconciliationRunDetailPage({ params: { id: RUN.id } }));
    expect(screen.getByText("Run not found")).toBeInTheDocument();
    expect(screen.getByText("Reconciliation Workbench")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  // GAP-FINANCE-RECONCILIATION-DETAIL-02
  it("shows the run status pill and completed date", async () => {
    fetchJsonMock.mockResolvedValue({ data: { data: RUN, breaks: [] }, source: "api" });
    render(await ReconciliationRunDetailPage({ params: { id: RUN.id } }));
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText(/completed .*(01\/07\/2026|01 Jul 2026)/)).toBeInTheDocument();
    expect(screen.queryByText(/still in progress/)).not.toBeInTheDocument();
    expect(screen.getByText("Unbalanced")).toBeInTheDocument();
  });

  it("flags a running run as in progress and withholds the Unbalanced verdict", async () => {
    fetchJsonMock.mockResolvedValue({ data: { data: { ...RUN, status: "running", completedAt: null }, breaks: [] }, source: "api" });
    render(await ReconciliationRunDetailPage({ params: { id: RUN.id } }));
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Run still in progress; counts may change.")).toBeInTheDocument();
    expect(screen.queryByText("Unbalanced")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-RECONCILIATION-DETAIL-04: 100 source / 98 target / 95 matched -> 5 and 3 unmatched
  it("shows unmatched rows per side and links Breaks to the exceptions table", async () => {
    fetchJsonMock.mockResolvedValue({ data: { data: RUN, breaks: [EXCEPTION] }, source: "api" });
    const { container } = render(await ReconciliationRunDetailPage({ params: { id: RUN.id } }));
    const note = screen.getByText(/Unmatched rows:/);
    expect(note.textContent).toMatch(/5.*in finance-book.*3.*in bank-statement/);
    expect(screen.getByRole("link", { name: "View 1 breaks for this run" })).toHaveAttribute("href", "#exceptions");
    expect(container.querySelector("#exceptions")).not.toBeNull();
  });

  // GAP-FINANCE-RECONCILIATION-DETAIL-05
  it("hides exception actions from an audit_officer", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    fetchJsonMock.mockResolvedValue({ data: { data: RUN, breaks: [EXCEPTION] }, source: "api" });
    render(await ReconciliationRunDetailPage({ params: { id: RUN.id } }));
    expect(screen.getByText("UTR12345")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Resolve exception/)).not.toBeInTheDocument();
  });
});
