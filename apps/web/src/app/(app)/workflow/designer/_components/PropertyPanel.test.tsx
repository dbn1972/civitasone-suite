import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PropertyPanel } from "./PropertyPanel";
import type { Node } from "reactflow";

const mockNode: Node = {
  id: "node-1",
  type: "task",
  position: { x: 100, y: 200 },
  data: { label: "Review Document", assignee: "finance_officer", description: "Review the submitted document" },
};

describe("PropertyPanel", () => {
  it("shows placeholder when no node is selected", () => {
    render(
      <PropertyPanel selectedNode={null} onLabelChange={vi.fn()} onPropertyChange={vi.fn()} />,
    );

    expect(screen.getByText("Select an element on the canvas to view and edit its properties.")).toBeInTheDocument();
  });

  it("displays node ID when a node is selected", () => {
    render(
      <PropertyPanel selectedNode={mockNode} onLabelChange={vi.fn()} onPropertyChange={vi.fn()} />,
    );

    expect(screen.getByDisplayValue("node-1")).toBeInTheDocument();
  });

  it("displays formatted node type", () => {
    render(
      <PropertyPanel selectedNode={mockNode} onLabelChange={vi.fn()} onPropertyChange={vi.fn()} />,
    );

    expect(screen.getByDisplayValue("Task")).toBeInTheDocument();
  });

  it("shows editable label input with current value", () => {
    render(
      <PropertyPanel selectedNode={mockNode} onLabelChange={vi.fn()} onPropertyChange={vi.fn()} />,
    );

    const labelInput = screen.getByLabelText("Label");
    expect(labelInput).toHaveValue("Review Document");
  });

  it("calls onLabelChange when label is edited", () => {
    const onLabelChange = vi.fn();
    render(
      <PropertyPanel selectedNode={mockNode} onLabelChange={onLabelChange} onPropertyChange={vi.fn()} />,
    );

    const labelInput = screen.getByLabelText("Label");
    fireEvent.change(labelInput, { target: { value: "Approve Document" } });
    expect(onLabelChange).toHaveBeenCalledWith("node-1", "Approve Document");
  });

  it("shows assignee field for task nodes", () => {
    render(
      <PropertyPanel selectedNode={mockNode} onLabelChange={vi.fn()} onPropertyChange={vi.fn()} />,
    );

    expect(screen.getByLabelText("Assignee Role")).toBeInTheDocument();
    expect(screen.getByDisplayValue("finance_officer")).toBeInTheDocument();
  });

  it("shows description field for task nodes", () => {
    render(
      <PropertyPanel selectedNode={mockNode} onLabelChange={vi.fn()} onPropertyChange={vi.fn()} />,
    );

    expect(screen.getByLabelText("Description")).toBeInTheDocument();
  });

  it("shows condition field for gateway nodes", () => {
    const gatewayNode: Node = {
      id: "gw-1",
      type: "exclusiveGateway",
      position: { x: 150, y: 250 },
      data: { label: "Amount Check", condition: "amount > 100000" },
    };

    render(
      <PropertyPanel selectedNode={gatewayNode} onLabelChange={vi.fn()} onPropertyChange={vi.fn()} />,
    );

    expect(screen.getByLabelText("Condition Expression")).toBeInTheDocument();
    expect(screen.getByDisplayValue("amount > 100000")).toBeInTheDocument();
  });

  it("displays position coordinates", () => {
    render(
      <PropertyPanel selectedNode={mockNode} onLabelChange={vi.fn()} onPropertyChange={vi.fn()} />,
    );

    expect(screen.getByText("x: 100")).toBeInTheDocument();
    expect(screen.getByText("y: 200")).toBeInTheDocument();
  });

  it("calls onPropertyChange when assignee is edited", () => {
    const onPropertyChange = vi.fn();
    render(
      <PropertyPanel selectedNode={mockNode} onLabelChange={vi.fn()} onPropertyChange={onPropertyChange} />,
    );

    const assigneeInput = screen.getByLabelText("Assignee Role");
    fireEvent.change(assigneeInput, { target: { value: "procurement_admin" } });
    expect(onPropertyChange).toHaveBeenCalledWith("node-1", "assignee", "procurement_admin");
  });
});
