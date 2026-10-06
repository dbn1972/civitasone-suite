import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ProjectDetailActions } from "./ProjectDetailActions";

const MILESTONES = [
  { id: "m2", title: "Second", status: "pending", dueDate: "2026-06-01" },
  { id: "m1", title: "First", status: "pending", dueDate: "2026-03-01" },
  { id: "m0", title: "Done", status: "completed", dueDate: "2026-01-01" },
];

describe("GAP-PROJECTS-DETAIL-02/03 ProjectDetailActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders NO completion control for a viewer (canComplete=false)", () => {
    const { container } = render(
      <ProjectDetailActions projectId="p1" milestones={MILESTONES} canComplete={false} />,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders a SINGLE action targeting the earliest-due pending milestone", () => {
    render(<ProjectDetailActions projectId="p1" milestones={MILESTONES} canComplete />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    // "First" is due 2026-03-01, earlier than "Second" (2026-06-01).
    expect(screen.getByText(/Complete next milestone: First/)).toBeInTheDocument();
    expect(screen.queryByText(/Second/)).not.toBeInTheDocument();
  });

  it("dialog copy no longer claims a fund release (money accuracy / HUMAN REVIEW)", () => {
    render(<ProjectDetailActions projectId="p1" milestones={MILESTONES} canComplete />);
    fireEvent.click(screen.getByText(/Complete next milestone: First/));
    expect(screen.getByText(/writes an entry to the audit trail/)).toBeInTheDocument();
    expect(screen.queryByText(/triggers a fund release/)).not.toBeInTheDocument();
  });

  it("renders nothing when there are no pending milestones", () => {
    const { container } = render(
      <ProjectDetailActions projectId="p1" milestones={[{ id: "x", title: "Done", status: "completed" }]} canComplete />,
    );
    expect(container.querySelector("button")).toBeNull();
  });
});
