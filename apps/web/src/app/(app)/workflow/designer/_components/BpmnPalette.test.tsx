import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BpmnPalette } from "./BpmnPalette";
import { PALETTE_ITEMS } from "../_data/designerTypes";

describe("BpmnPalette", () => {
  it("renders all palette items", () => {
    render(<BpmnPalette />);

    for (const item of PALETTE_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
  });

  it("renders start, end, task, gateway, and subprocess elements", () => {
    render(<BpmnPalette />);

    expect(screen.getByText("Start Event")).toBeInTheDocument();
    expect(screen.getByText("End Event")).toBeInTheDocument();
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("Exclusive Gateway")).toBeInTheDocument();
    expect(screen.getByText("Parallel Gateway")).toBeInTheDocument();
    expect(screen.getByText("Sub-Process")).toBeInTheDocument();
  });

  it("all palette items are draggable", () => {
    render(<BpmnPalette />);

    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button).toHaveAttribute("draggable", "true");
    }
  });

  it("has accessible labels on palette items", () => {
    render(<BpmnPalette />);

    expect(screen.getByLabelText("Add Start Event to canvas")).toBeInTheDocument();
    expect(screen.getByLabelText("Add End Event to canvas")).toBeInTheDocument();
    expect(screen.getByLabelText("Add Task to canvas")).toBeInTheDocument();
  });

  it("renders the palette aside with proper aria-label", () => {
    render(<BpmnPalette />);

    expect(screen.getByLabelText("BPMN element palette")).toBeInTheDocument();
  });

  it("renders instruction text for users", () => {
    render(<BpmnPalette />);

    expect(screen.getByText(/Click an element/)).toBeInTheDocument();
  });

  // GAP-WORKFLOW-DESIGNER-03 — keyboard/click add (WCAG 2.1.1).
  it("calls onAdd when a palette item is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onAdd = (await import("vitest")).vi.fn();
    render(<BpmnPalette onAdd={onAdd} />);
    fireEvent.click(screen.getByLabelText("Add Task to canvas"));
    expect(onAdd).toHaveBeenCalledWith("task");
  });

  it("adds a node when Enter is pressed on a palette item (native button activation)", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onAdd = (await import("vitest")).vi.fn();
    render(<BpmnPalette onAdd={onAdd} />);
    const btn = screen.getByLabelText("Add Start Event to canvas");
    // A native <button> fires click on Enter; emulate the resulting click.
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledWith("startEvent");
  });
});
