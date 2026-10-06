import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DefinitionGraph } from "./DefinitionGraph";
import type { WorkflowNode, WorkflowEdge } from "../_data/workflowTypes";

const node = (over: Partial<WorkflowNode> = {}): WorkflowNode => ({
  nodeKey: "so_review",
  name: "SO Review",
  nodeType: "task",
  roleRef: "section_officer",
  slaMinutes: 2880,
  assignStrategy: null,
  sortOrder: 1,
  ...over,
});

describe("DefinitionGraph (GAP-WORKFLOW-DEFINITIONS-DETAIL-04/05)", () => {
  it("renders SLA as a human duration, not raw minutes", () => {
    render(<DefinitionGraph nodes={[node()]} edges={[]} />);
    expect(screen.getByText("SLA 2.0d")).toBeInTheDocument();
    expect(screen.queryByText("SLA 2880m")).not.toBeInTheDocument();
  });

  it("humanizes the role reference", () => {
    render(<DefinitionGraph nodes={[node()]} edges={[]} />);
    expect(screen.getByText("Section Officer")).toBeInTheDocument();
  });

  it("keeps the node key in a tooltip title rather than a visible raw label row", () => {
    render(<DefinitionGraph nodes={[node()]} edges={[]} />);
    const key = screen.getByLabelText("Node key so_review");
    expect(key).toHaveAttribute("title", "Node key: so_review");
  });

  it("labels edge conditions accessibly", () => {
    const edges: WorkflowEdge[] = [
      { fromNode: "so_review", toNode: "done", condition: "amount > 100000", sortOrder: 1 },
    ];
    render(
      <DefinitionGraph
        nodes={[node(), node({ nodeKey: "done", name: "Done", roleRef: null, slaMinutes: null })]}
        edges={edges}
      />,
    );
    expect(screen.getByLabelText("when amount > 100000")).toBeInTheDocument();
  });
});
