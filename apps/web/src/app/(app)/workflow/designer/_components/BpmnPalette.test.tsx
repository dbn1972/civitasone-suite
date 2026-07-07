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

    expect(screen.getByLabelText("Drag Start Event onto canvas")).toBeInTheDocument();
    expect(screen.getByLabelText("Drag End Event onto canvas")).toBeInTheDocument();
    expect(screen.getByLabelText("Drag Task onto canvas")).toBeInTheDocument();
  });

  it("renders the palette aside with proper aria-label", () => {
    render(<BpmnPalette />);

    expect(screen.getByLabelText("BPMN element palette")).toBeInTheDocument();
  });

  it("renders instruction text for users", () => {
    render(<BpmnPalette />);

    expect(screen.getByText(/Drag elements from this palette/)).toBeInTheDocument();
  });
});
