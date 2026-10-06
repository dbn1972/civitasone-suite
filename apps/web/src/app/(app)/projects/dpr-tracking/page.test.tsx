import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./DprTrackingTable", () => ({
  DprTrackingTable: ({ rows }: { rows: unknown[] }) => <div>dpr-table:{rows.length}</div>,
}));

import DprTrackingPage from "./page";

function mock(rows: unknown[]) {
  fetchJsonMock.mockImplementation(() => Promise.resolve({ data: rows, source: "api" }));
}
function tile(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.textContent;
}

describe("DprTrackingPage (GAP-PROJECTS-DPR-TRACKING-01)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("labels the rejected-count tile 'Rejected' (matching the status pill), not 'Returned'", async () => {
    mock([
      { dprNo: "D1", projectId: "p", projectTitle: "A", submittedBy: "u", submittedDate: "2026-01-01", estimatedCost: "—", status: "rejected", reviewingAuthority: "PMU" },
    ]);
    render(await DprTrackingPage());
    expect(tile("Rejected")).toContain("1");
    expect(screen.queryByText("Returned")).not.toBeInTheDocument();
  });
});
