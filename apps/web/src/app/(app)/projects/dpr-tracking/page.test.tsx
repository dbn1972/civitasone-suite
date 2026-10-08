import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./DprTrackingTable", () => ({
  DprTrackingTable: ({ rows, canReview }: { rows: unknown[]; canReview?: boolean }) => <div>dpr-table:{rows.length}:{canReview ? "review" : "readonly"}</div>,
}));
// getSessionRoles reads cookies() (next/headers); stub the role gate so the
// server page renders under vitest without a request context.
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => ["project_manager"] };
});

import DprTrackingPage from "./page";

function mock(rows: unknown[]) {
  fetchJsonMock.mockImplementation(() => Promise.resolve({ data: rows, source: "api" }));
}
function tile(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.textContent;
}

describe("DprTrackingPage (GAP-PROJECTS-DPR-TRACKING-01)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("labels the returned-count tile 'Returned for revision' (matching the status pill) and counts the real 'revision' status", async () => {
    mock([
      { id: "d1", dprNo: "D1", projectId: "p", projectTitle: "A", submittedBy: "u", submittedDate: "2026-01-01", estimatedCost: "—", status: "revision", reviewingAuthority: "PMU" },
    ]);
    render(await DprTrackingPage());
    expect(tile("Returned for revision")).toContain("1");
    // The misleading 'Rejected' label (a status this backend never emits) is gone.
    expect(screen.queryByText("Rejected")).not.toBeInTheDocument();
  });

  it("counts submitted + under_review DPRs under 'Under Review'", async () => {
    mock([
      { id: "d1", dprNo: "D1", projectId: "p", projectTitle: "A", submittedBy: "u", submittedDate: "2026-01-01", estimatedCost: "—", status: "submitted", reviewingAuthority: "PMU" },
      { id: "d2", dprNo: "D2", projectId: "p2", projectTitle: "B", submittedBy: "u", submittedDate: "2026-01-02", estimatedCost: "—", status: "under_review", reviewingAuthority: "PMU" },
    ]);
    render(await DprTrackingPage());
    expect(tile("Under Review")).toContain("2");
  });
});
