import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

describe("Tabs", () => {
  const tabs = ["All", "Pending", "Approved"];

  it("renders all tab items", () => {
    render(<Tabs tabs={tabs} active="All" onChange={vi.fn()} />);
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("marks active tab with 'on' class", () => {
    render(<Tabs tabs={tabs} active="Pending" onChange={vi.fn()} />);
    expect(screen.getByText("Pending")).toHaveClass("on");
    expect(screen.getByText("All")).not.toHaveClass("on");
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

  it("does not call onChange on other keys", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="All" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Pending"), { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("each tab has role=button and tabIndex=0 for accessibility", () => {
    render(<Tabs tabs={tabs} active="All" onChange={vi.fn()} />);
    const el = screen.getByText("Pending");
    expect(el).toHaveAttribute("role", "button");
    expect(el).toHaveAttribute("tabindex", "0");
  });
});
