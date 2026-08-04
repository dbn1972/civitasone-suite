import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Segmented } from "./Segmented";

describe("Segmented", () => {
  const options = ["Day", "Week", "Month"];

  it("renders all options inside a tablist", () => {
    render(<Segmented options={options} value="Day" onChange={vi.fn()} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Week")).toBeInTheDocument();
    expect(screen.getByText("Month")).toBeInTheDocument();
  });

  it("marks selected option with 'on' class and aria-selected", () => {
    render(<Segmented options={options} value="Week" onChange={vi.fn()} />);
    expect(screen.getByText("Week")).toHaveClass("on");
    expect(screen.getByText("Week")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Day")).not.toHaveClass("on");
    expect(screen.getByText("Day")).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange on click", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="Day" onChange={onChange} />);
    fireEvent.click(screen.getByText("Month"));
    expect(onChange).toHaveBeenCalledWith("Month");
  });

  it("calls onChange on Enter keydown", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="Day" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Week"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Week");
  });

  it("calls onChange on Space keydown", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="Day" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Month"), { key: " " });
    expect(onChange).toHaveBeenCalledWith("Month");
  });

  it("does not call onChange on other keys", () => {
    const onChange = vi.fn();
    render(<Segmented options={options} value="Day" onChange={onChange} />);
    fireEvent.keyDown(screen.getByText("Week"), { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("each option is keyboard accessible (role=tab, tabIndex=0)", () => {
    render(<Segmented options={options} value="Day" onChange={vi.fn()} />);
    const el = screen.getByText("Week");
    expect(el).toHaveAttribute("role", "tab");
    expect(el).toHaveAttribute("tabindex", "0");
  });
});
