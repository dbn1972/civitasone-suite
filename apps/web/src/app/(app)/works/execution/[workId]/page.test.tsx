import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// The actions panel is a client component with its own deps (dialogs, toast);
// stub it — this test is about the Work Scopes table rendering real fields.
vi.mock("./ExecutionActions", () => ({ ExecutionActions: () => null }));

import ExecutionDetailPage from "./page";

// REAL work_scopes rows from GET /v1/works/execution/:workId/scopes (raw select;
// works-service execution/repo.ts listScopes, schema.ts). Columns are
// { id, scopeId, targetValue, description, plannedStart, plannedEnd, ... } — no
// scopeName / targetQuantity / unit / startDate / endDate / status.
const SCOPE_A = {
  id: "ws-a",
  scopeId: "aaaaaaaa-1111-2222-3333-444444444444",
  targetValue: "250",
  description: "Bituminous surfacing",
  plannedStart: "2026-01-10T12:00:00.000Z",
  plannedEnd: "2026-06-30T12:00:00.000Z",
  version: 1,
};
const SCOPE_B = {
  id: "ws-b",
  scopeId: "bbbbbbbb-5555-6666-7777-888888888888",
  targetValue: "80",
  description: null, // optional — must still render a distinguishable label
  plannedStart: null,
  plannedEnd: null,
  version: 1,
};

describe("ExecutionDetailPage — Work Scopes table", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders real work_scopes fields (description, target, planned dates), not dashes", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [SCOPE_A, SCOPE_B], source: "api" }) // scopes
      .mockResolvedValueOnce({ data: [], source: "api" }); // issues

    const ui = await ExecutionDetailPage({ params: { workId: "work-123" } });
    render(ui);

    // Real description + target render — the buggy mapping showed "—" and "0"
    // (scopeName/targetQuantity don't exist on the row).
    expect(screen.getByText("Bituminous surfacing")).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();
    // Planned dates render (buggy mapping read startDate/endDate → null → "—").
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    // A scope with no description falls back to a scopeId-derived label, never a
    // blank/dash.
    expect(screen.getByText(/Scope bbbbbbbb/)).toBeInTheDocument();

    // Columns / cards that mapped nonexistent fields are gone.
    expect(screen.queryByText("Unit")).toBeNull(); // dropped scopes column
    expect(screen.queryByText("Overall Progress")).toBeNull(); // status-derived, unbacked
  });

  it("shows a guided empty state (not fabricated rows) when there are no scopes", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "api" }) // scopes
      .mockResolvedValueOnce({ data: [], source: "api" }); // issues

    const ui = await ExecutionDetailPage({ params: { workId: "work-123" } });
    render(ui);

    expect(screen.getByText("No scopes defined")).toBeInTheDocument();
  });
});
