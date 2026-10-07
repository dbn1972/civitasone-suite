import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryTimeline } from "./HistoryTimeline";
import type { WorkflowTransition } from "../_data/workflowTypes";

const tx = (over: Partial<WorkflowTransition> = {}): WorkflowTransition => ({
  id: "h1",
  fromNode: "start",
  toNode: "review",
  action: "advance",
  decision: "approve",
  actorId: "8f2d41ab-1111-4222-8333-444455556666",
  createdAt: "2026-01-02T10:00:00.000Z",
  ...over,
});

describe("HistoryTimeline (GAP-WORKFLOW-INSTANCES-DETAIL-01)", () => {
  it("renders the server-resolved actor name when present, not just a bare id", () => {
    render(<HistoryTimeline transitions={[tx({ actorName: "A. Kumar" })]} />);
    // The human name is shown...
    expect(screen.getByText("A. Kumar")).toBeInTheDocument();
    // ...and the full id stays available for copy via the title.
    const span = screen.getByText("A. Kumar").closest("span");
    expect(span).toHaveAttribute("title", "8f2d41ab-1111-4222-8333-444455556666");
  });

  it("falls back to a short id (never a guessed name) when no actorName is resolved", () => {
    render(<HistoryTimeline transitions={[tx()]} />);
    const short = screen.getByTitle("8f2d41ab-1111-4222-8333-444455556666");
    expect(short.textContent).toContain("8f2d41ab");
    // No fabricated name: the only on-screen text for the actor is the short id.
    expect(screen.queryByText("A. Kumar")).not.toBeInTheDocument();
  });
});
