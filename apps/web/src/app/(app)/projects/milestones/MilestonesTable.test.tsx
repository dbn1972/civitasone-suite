import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MilestonesTable, type MilestoneRow } from "./MilestonesTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const row: MilestoneRow = {
  id: "m1",
  projectId: "p-9",
  projectName: "Rural Roads",
  title: "Phase 1 handover",
  dueDate: "2026-03-01",
  status: "delayed",
};

describe("MilestonesTable (GAP-PROJECTS-MILESTONES-03/04)", () => {
  it("links each row to its project via projectId", () => {
    render(<MilestonesTable rows={[row]} />);
    const link = screen.getByRole("link", { name: /Open Phase 1 handover/i });
    expect(link).toHaveAttribute("href", "/projects/p-9");
  });

  it("renders a delayed milestone as a red pill (StatusPill already maps 'delayed'->bad)", () => {
    render(<MilestonesTable rows={[row]} />);
    const pill = screen.getByText("Delayed");
    expect(pill).toHaveClass("pill", "bad");
  });
});
