import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

describe("Tabs", () => {
  const tabs = ["All", "Pending", "Approved"];

  it("renders all tab items inside a tablist", () => {
    render(<Tabs tabs={tabs} active="All" onChange={vi.fn()} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("marks active tab with 'on' class and aria-selected", () => {
    render(<Tabs tabs={tabs} active="Pending" onChange={vi.fn()} />);
    expect(screen.getByText("Pending")).toHaveClass("on");
    expect(screen.getByText("Pending")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("All")).not.toHaveClass("on");
    expect(screen.getByText("All")).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange on click", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="All" onChange={onChange} />);
    fireEvent.click(screen.getByText("Approved"));
    expect(onChange).toHaveBeenCalledWith("Approved");
  });

  it("calls onChange on Enter keydown", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="All" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Pending"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Pending");
  });

  it("calls onChange on Space keydown", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="All" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Approved"), { key: " " });
    expect(onChange).toHaveBeenCalledWith("Approved");
  });

  it("does not call onChange on other keys", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="All" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Pending"), { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("each tab has role=tab", () => {
    render(<Tabs tabs={tabs} active="All" onChange={vi.fn()} />);
    expect(screen.getByText("Pending")).toHaveAttribute("role", "tab");
  });

  // Roving tabindex: only the active tab sits in the page Tab order, per the
  // WAI-ARIA tabs pattern -- arrow keys (below) move focus among the rest.
  it("only the active tab has tabIndex=0; the others have tabIndex=-1", () => {
    render(<Tabs tabs={tabs} active="All" onChange={vi.fn()} />);
    expect(screen.getByText("All")).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Pending")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("Approved")).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowRight moves to and activates the next tab, wrapping past the last", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="Approved" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Approved"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("All");
  });

  it("ArrowLeft moves to and activates the previous tab, wrapping before the first", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="All" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("All"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("Approved");
  });

  it("Home moves focus and activation to the first tab", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="Approved" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Approved"), { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("All");
  });

  it("End moves focus and activation to the last tab", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="All" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("All"), { key: "End" });
    expect(onChange).toHaveBeenCalledWith("Approved");
  });
});
