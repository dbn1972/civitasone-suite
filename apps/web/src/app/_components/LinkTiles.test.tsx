import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LinkTiles } from "./LinkTiles";

describe("LinkTiles", () => {
  const tiles = [
    { title: "Dashboard", href: "/dashboard", description: "Overview stats" },
    { title: "Employees", href: "/hr/employees", description: "Manage staff" },
    { title: "Payments", href: "/finance/payments" },
  ];

  it("renders all tiles as links", () => {
    render(<LinkTiles tiles={tiles} />);
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /Employees/ })).toHaveAttribute("href", "/hr/employees");
    expect(screen.getByRole("link", { name: /Payments/ })).toHaveAttribute("href", "/finance/payments");
  });

  it("renders tile titles", () => {
    render(<LinkTiles tiles={tiles} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Employees")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
  });

  it("renders tile descriptions when provided", () => {
    render(<LinkTiles tiles={tiles} />);
    expect(screen.getByText("Overview stats")).toBeInTheDocument();
    expect(screen.getByText("Manage staff")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    render(<LinkTiles tiles={[{ title: "Test", href: "/test" }]} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].querySelector(".l")).not.toBeInTheDocument();
  });

  it("applies three-column grid by default", () => {
    const { container } = render(<LinkTiles tiles={tiles} />);
    expect(container.querySelector(".grid.g-3")).toBeInTheDocument();
  });

  it("applies four-column grid when columns='four'", () => {
    const { container } = render(<LinkTiles tiles={tiles} columns="four" />);
    expect(container.querySelector(".grid.g-4")).toBeInTheDocument();
  });

  it("maps known tile icon from TILE_ICONS", () => {
    const { container } = render(<LinkTiles tiles={[{ title: "Dashboard", href: "/d" }]} />);
    expect(container.querySelector(".ic")?.textContent).toBe("📊");
  });
});
