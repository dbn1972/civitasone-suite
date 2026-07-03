import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Segmented } from "./Segmented";

describe("Segmented", () => {
  const options = ["Day", "Week", "Month"];

  it("renders all options", () => {
    render(<Segmented options={options} value="Day" onChange={vi.fn()} />);
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Week")).toBeInTheDocument();
    expect(screen.getByText("Month")).toBeInTheDocument();
  });

  it("marks selected option with 'on' class", () => {
    render(<Segmented options={options} value="Week" onChange={vi.fn()} />);
    expect(screen.getByText("Week")).toHaveClass("on");
    expect(screen.getByText("Day")).not.toHaveClass("on");
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

  it("each option is keyboard accessible (role=button, tabIndex=0)", () => {
    render(<Segmented options={options} value="Day" onChange={vi.fn()} />);
    const el = screen.getByText("Week");
    expect(el).toHaveAttribute("role", "button");
    expect(el).toHaveAttribute("tabindex", "0");
  });
});
