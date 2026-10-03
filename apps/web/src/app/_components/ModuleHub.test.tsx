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

  // GAP-ASSETS-HOME-01
  it("renders headed groups, one tile grid per group, when groups are given", () => {
    render(
      <ModuleHub
        title="Assets"
        description="desc"
        groups={[
          { heading: "Register", links: [{ href: "/a/new", label: "New" }] },
          { heading: "Registers", links: [{ href: "/a/list", label: "List" }, { href: "/a/fixed", label: "Fixed" }] },
        ]}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Register", "Registers"]);
    expect(screen.getByRole("region", { name: "Registers" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });
});
