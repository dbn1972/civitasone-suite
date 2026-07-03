import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the title as an h1", () => {
    render(<PageHeader title="Finance Dashboard" />);
    expect(screen.getByRole("heading", { level: 1, name: "Finance Dashboard" })).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(<PageHeader title="Bills" subtitle="Manage all bills" />);
    expect(screen.getByText("Manage all bills")).toBeInTheDocument();
  });

  it("does not render subtitle when not provided", () => {
    const { container } = render(<PageHeader title="Bills" />);
    expect(container.querySelector(".sub")).not.toBeInTheDocument();
  });

  it("renders back link when back href is provided", () => {
    render(<PageHeader title="Detail" back="/list" />);
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/list");
  });

  it("renders custom back label", () => {
    render(<PageHeader title="Detail" back="/list" backLabel="Return to list" />);
    expect(screen.getByRole("link", { name: "Return to list" })).toBeInTheDocument();
  });

  it("renders actions node", () => {
    render(<PageHeader title="Bills" actions={<button>Add bill</button>} />);
    expect(screen.getByRole("button", { name: "Add bill" })).toBeInTheDocument();
  });

  it("renders help link when help slug is provided", () => {
    render(<PageHeader title="Bills" help="bills" />);
    const helpLink = screen.getByRole("link", { name: /how this works/i });
    expect(helpLink).toHaveAttribute("href", "/help/bills");
  });

  it("sets page heading id for aria-labelledby usage", () => {
    render(<PageHeader title="Overview" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "page-heading");
  });
});
