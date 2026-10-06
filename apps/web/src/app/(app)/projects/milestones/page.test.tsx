import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./MilestonesTable", () => ({
  MilestonesTable: ({ rows }: { rows: unknown[] }) => <div>milestones-table:{rows.length}</div>,
}));

import MilestonesPage from "./page";

function mock(rows: unknown[]) {
  fetchJsonMock.mockImplementation(() => Promise.resolve({ data: rows, source: "api" }));
}

function tile(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.textContent;
}

describe("MilestonesPage (GAP-PROJECTS-MILESTONES-01/02)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("uses honest subtitle copy (no unimplemented define/trigger-payment promise)", async () => {
    mock([]);
    render(await MilestonesPage());
    expect(screen.getByText(/Milestone status across all projects/)).toBeInTheDocument();
    expect(screen.queryByText(/trigger payment release/)).not.toBeInTheDocument();
  });

  it("tiles reconcile to Total across all three statuses (MilestoneSummary has no in_progress)", async () => {
    mock([
      { id: "1", projectId: "p", projectName: "A", title: "t1", dueDate: "2026-01-01", status: "pending" },
      { id: "2", projectId: "p", projectName: "A", title: "t2", dueDate: "2026-01-01", status: "completed" },
      { id: "3", projectId: "p", projectName: "A", title: "t3", dueDate: "2026-01-01", status: "delayed" },
      { id: "4", projectId: "p", projectName: "A", title: "t4", dueDate: "2026-01-01", status: "pending" },
    ]);
    render(await MilestonesPage());
    expect(tile("Total")).toContain("4");
    expect(tile("Pending")).toContain("2");
    expect(tile("Completed")).toContain("1");
    expect(tile("Delayed")).toContain("1");
    // 2 + 1 + 1 == 4 (Total) -> tiles reconcile.
  });
});
