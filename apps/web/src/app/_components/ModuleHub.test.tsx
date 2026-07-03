import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModuleHub } from "./ModuleHub";

describe("ModuleHub", () => {
  const links = [
    { href: "/finance/bills", label: "Bills", note: "Manage vendor bills" },
    { href: "/finance/payments", label: "Payments" },
  ];

  it("renders page title", () => {
    render(<ModuleHub title="Finance" description="Manage budgets and payments" links={links} />);
    expect(screen.getByRole("heading", { level: 1, name: "Finance" })).toBeInTheDocument();
  });

  it("renders description", () => {
    render(<ModuleHub title="Finance" description="Manage budgets and payments" links={links} />);
    expect(screen.getByText("Manage budgets and payments")).toBeInTheDocument();
  });

  it("renders link tiles from links prop", () => {
    render(<ModuleHub title="Finance" description="desc" links={links} />);
    expect(screen.getByText("Bills")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
  });

  it("renders notes as tile descriptions", () => {
    render(<ModuleHub title="Finance" description="desc" links={links} />);
    expect(screen.getByText("Manage vendor bills")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <ModuleHub title="Finance" description="desc" links={links}>
        <div>Stats widget</div>
      </ModuleHub>,
    );
    expect(screen.getByText("Stats widget")).toBeInTheDocument();
  });

  it("renders help link when help prop is provided", () => {
    render(<ModuleHub title="Finance" description="desc" links={links} help="finance" />);
    expect(screen.getByRole("link", { name: /how this works/i })).toHaveAttribute("href", "/help/finance");
  });
});
