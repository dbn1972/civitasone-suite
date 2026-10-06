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
  it("exposes the full actor id in a copyable title rather than only a bare truncation", () => {
    render(<HistoryTimeline transitions={[tx()]} />);
    const actor = screen.getByLabelText("User ID 8f2d41ab-1111-4222-8333-444455556666");
    expect(actor).toHaveAttribute("title", "User ID: 8f2d41ab-1111-4222-8333-444455556666");
    expect(actor.textContent).toContain("8f2d41ab");
  });
});
