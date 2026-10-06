import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Every loader + direct fetch on this page goes through fetchJson; we drive
// them in call order: [0] header, [1] scopes, [2] issues, [3] progress.
// getWorkHeader/getWorkProgress live in ../../_data/loaders but ultimately
// call this same fetchJson, so stubbing fetchJson covers all four.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./ExecutionActions", () => ({ ExecutionActions: () => null }));

import ExecutionDetailPage from "./page";

const SCOPE_A = {
  id: "ws-a",
  scopeId: "aaaaaaaa-1111-2222-3333-444444444444",
  targetValue: "100",
  description: "Bituminous surfacing",
  plannedStart: "2026-01-10T12:00:00.000Z",
  plannedEnd: "2026-06-30T12:00:00.000Z",
};

describe("ExecutionDetailPage (GAP-WORKS-EXECUTION-WORKID-01/03/04/05/06)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("WORKID-01: header shows the work number + description, never a UUID prefix", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: { workNumber: "W-2025-014", description: "Village road" }, source: "api" })
      .mockResolvedValueOnce({ data: [SCOPE_A], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [{ scopeId: SCOPE_A.scopeId, percentage: 30 }], source: "api" });

    render(await ExecutionDetailPage({ params: { workId: "3f9a1c20-aaaa-bbbb-cccc-dddddddddddd" } }));

    expect(screen.getByText(/W-2025-014 — Village road/)).toBeInTheDocument();
    expect(screen.queryByText(/Work 3f9a1c20…/)).toBeNull();
  });

  it("WORKID-04: a scope's achieved % renders from the progress register", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: { workNumber: "W-1", description: "d" }, source: "api" })
      .mockResolvedValueOnce({ data: [SCOPE_A], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [{ scopeId: SCOPE_A.scopeId, percentage: 30 }], source: "api" });

    render(await ExecutionDetailPage({ params: { workId: "w1" } }));
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("WORKID-03: there is no Priority column", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: { workNumber: "W-1", description: "d" }, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [{ id: "i1", workId: "w1", description: "x", status: "open" }], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    render(await ExecutionDetailPage({ params: { workId: "w1" } }));
    expect(screen.queryByText("Priority")).toBeNull();
  });

  it("WORKID-06: a work with no issues reads 'No issues raised', not 'No open issues'", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: { workNumber: "W-1", description: "d" }, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    render(await ExecutionDetailPage({ params: { workId: "w1" } }));
    expect(screen.getByText("No issues raised")).toBeInTheDocument();
    expect(screen.queryByText("No open issues")).toBeNull();
  });

  it("WORKID-05: scopes ok but issues failed → issues section shows a retry state and Open/Closed stats show '—'", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: { workNumber: "W-1", description: "d" }, source: "api" })
      .mockResolvedValueOnce({ data: [SCOPE_A], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [{ scopeId: SCOPE_A.scopeId, percentage: 30 }], source: "api" });

    render(await ExecutionDetailPage({ params: { workId: "w1" } }));

    // Scopes still render.
    expect(screen.getByText("Bituminous surfacing")).toBeInTheDocument();
    // Issues section shows an error/retry state.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Open/Closed issue stats are blanked (—), not a misleading 0.
    expect(screen.getByText("Open Issues").closest(".stat")!.querySelector(".val")!.textContent).toBe("—");
  });

  it("WORKID-05: a progress-fetch error shows '—' for Achieved, not 0%", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: { workNumber: "W-1", description: "d" }, source: "api" })
      .mockResolvedValueOnce({ data: [SCOPE_A], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "error" });

    render(await ExecutionDetailPage({ params: { workId: "w1" } }));
    // Achieved cell shows an em dash, never 0%.
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0%")).toBeNull();
  });
});
