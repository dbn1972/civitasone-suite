import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCardGrid } from "./StatCardGrid";

describe("StatCardGrid", () => {
  const items = [
    { label: "Total Bills", value: "42", note: "This month" },
    { label: "Pending Approvals", value: "7" },
    { label: "Revenue", value: "₹12.5L", note: "Q1 FY26" },
  ];

  it("renders all metric cards", () => {
    render(<StatCardGrid items={items} />);
    expect(screen.getByText("Total Bills")).toBeInTheDocument();
    expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();
  });

  it("renders values for each card", () => {
    render(<StatCardGrid items={items} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("₹12.5L")).toBeInTheDocument();
  });

  it("renders note when provided", () => {
    render(<StatCardGrid items={items} />);
    expect(screen.getByText("This month")).toBeInTheDocument();
    expect(screen.getByText("Q1 FY26")).toBeInTheDocument();
  });

  it("does not render note paragraph when note is undefined", () => {
    render(<StatCardGrid items={[{ label: "Test", value: "1" }]} />);
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(1);
    // Only label and value paragraphs
    const ps = articles[0].querySelectorAll("p");
    expect(ps).toHaveLength(2);
  });

  it("renders empty when items array is empty", () => {
    const { container } = render(<StatCardGrid items={[]} />);
    expect(container.querySelector("article")).not.toBeInTheDocument();
  });

  it("uses responsive grid classes", () => {
    const { container } = render(<StatCardGrid items={items} />);
    const grid = container.firstElementChild;
    expect(grid).toHaveClass("grid");
  });
});
