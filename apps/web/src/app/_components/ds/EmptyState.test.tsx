import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No records found" />);
    expect(screen.getByRole("heading", { name: "No records found" })).toBeInTheDocument();
  });

  it("renders message when provided", () => {
    render(<EmptyState title="Empty" message="Nothing to show" />);
    expect(screen.getByText("Nothing to show")).toBeInTheDocument();
  });

  it("does not render message paragraph when message is undefined", () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("renders icon with aria-hidden", () => {
    const { container } = render(<EmptyState title="Empty" icon="📋" />);
    const iconEl = container.querySelector("[aria-hidden]");
    expect(iconEl).toBeInTheDocument();
    expect(iconEl?.textContent).toBe("📋");
  });

  it("renders default SVG illustration when icon is undefined", () => {
    const { container } = render(<EmptyState title="Empty" />);
    const iconEl = container.querySelector(".ic");
    expect(iconEl).toBeInTheDocument();
    expect(iconEl?.querySelector("svg")).toBeInTheDocument();
  });

  it("renders action node when provided", () => {
    render(<EmptyState title="Empty" action={<button>Add first</button>} />);
    expect(screen.getByRole("button", { name: "Add first" })).toBeInTheDocument();
  });
});
