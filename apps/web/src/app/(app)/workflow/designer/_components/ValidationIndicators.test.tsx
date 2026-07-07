import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ValidationIndicators } from "./ValidationIndicators";
import type { Node } from "reactflow";
import type { DesignerViolation } from "../_data/designerTypes";

const nodes: Node[] = [
  { id: "start-1", type: "startEvent", position: { x: 0, y: 0 }, data: { label: "Start" } },
  { id: "gw-1", type: "exclusiveGateway", position: { x: 100, y: 0 }, data: { label: "Decision" } },
  { id: "end-1", type: "endEvent", position: { x: 200, y: 0 }, data: { label: "End" } },
];

describe("ValidationIndicators", () => {
  it("shows no issues message when violations is empty", () => {
    render(<ValidationIndicators violations={[]} nodes={nodes} />);

    expect(screen.getByText("No issues found")).toBeInTheDocument();
  });

  it("displays violation count in heading", () => {
    const violations: DesignerViolation[] = [
      { elementId: "gw-1", type: "GATEWAY_NO_OUTGOING", message: 'Gateway "Decision" has no outgoing flows' },
      { elementId: "__canvas", type: "MISSING_END", message: "Process must have at least one end event" },
    ];

    render(<ValidationIndicators violations={violations} nodes={nodes} />);

    expect(screen.getByText("Validation (2 issues)")).toBeInTheDocument();
  });

  it("uses singular issue when only one violation", () => {
    const violations: DesignerViolation[] = [
      { elementId: "__canvas", type: "MISSING_START", message: "Process must have at least one start event" },
    ];

    render(<ValidationIndicators violations={violations} nodes={nodes} />);

    expect(screen.getByText("Validation (1 issue)")).toBeInTheDocument();
  });

  it("displays violation message text", () => {
    const violations: DesignerViolation[] = [
      { elementId: "gw-1", type: "GATEWAY_NO_OUTGOING", message: 'Gateway "Decision" has no outgoing flows' },
    ];

    render(<ValidationIndicators violations={violations} nodes={nodes} />);

    expect(screen.getByText('Gateway "Decision" has no outgoing flows')).toBeInTheDocument();
  });

  it("resolves element label from node data", () => {
    const violations: DesignerViolation[] = [
      { elementId: "gw-1", type: "GATEWAY_NO_OUTGOING", message: "No outgoing flows" },
    ];

    render(<ValidationIndicators violations={violations} nodes={nodes} />);

    expect(screen.getByText("Decision")).toBeInTheDocument();
  });

  it("shows Canvas label for __canvas violations", () => {
    const violations: DesignerViolation[] = [
      { elementId: "__canvas", type: "MISSING_START", message: "Process must have at least one start event" },
    ];

    render(<ValidationIndicators violations={violations} nodes={nodes} />);

    expect(screen.getByText("Canvas")).toBeInTheDocument();
  });

  it("has proper ARIA role for alerting screen readers", () => {
    const violations: DesignerViolation[] = [
      { elementId: "__canvas", type: "MISSING_START", message: "Need start" },
    ];

    render(<ValidationIndicators violations={violations} nodes={nodes} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("no-violations panel uses status role for polite announcement", () => {
    render(<ValidationIndicators violations={[]} nodes={nodes} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
