import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("Sidebar", () => {
  it("renders brand name", () => {
    render(<Sidebar />);
    expect(screen.getByText("CivitasOne")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Suite")).toBeInTheDocument();
  });

  it("renders all navigation groups when no module filtering", () => {
    render(<Sidebar />);
    expect(screen.getByText("OVERVIEW")).toBeInTheDocument();
    expect(screen.getByText("FINANCE")).toBeInTheDocument();
    expect(screen.getByText("OPERATIONS")).toBeInTheDocument();
    expect(screen.getByText("PLATFORM")).toBeInTheDocument();
  });

  it("renders navigation links", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /Finance/ })).toHaveAttribute("href", "/finance");
    expect(screen.getByRole("link", { name: /HR & Payroll/ })).toHaveAttribute("href", "/hr");
  });

  it("marks active item with 'on' class", () => {
    render(<Sidebar />);
    const dashLink = screen.getByRole("link", { name: /Dashboard/ });
    expect(dashLink).toHaveClass("on");
  });

  it("non-active items don't have 'on' class", () => {
    render(<Sidebar />);
    const financeLink = screen.getByRole("link", { name: /Finance/ });
    expect(financeLink).not.toHaveClass("on");
  });

  it("filters items by enabledModules", () => {
    render(<Sidebar enabledModules={["finance"]} />);
    // Finance should be visible
    expect(screen.getByRole("link", { name: /Finance/ })).toBeInTheDocument();
    // HR should NOT be visible (not in enabled list)
    expect(screen.queryByRole("link", { name: /HR & Payroll/ })).not.toBeInTheDocument();
  });

  it("always shows items with null moduleKey regardless of enabledModules", () => {
    render(<Sidebar enabledModules={["finance"]} />);
    // Dashboard has moduleKey: null, so always visible
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Help Centre/ })).toBeInTheDocument();
  });

  it("hides entire group when no items are visible", () => {
    render(<Sidebar enabledModules={[]} />);
    // FINANCE group should be hidden (finance module not enabled)
    expect(screen.queryByText("FINANCE")).not.toBeInTheDocument();
    // OVERVIEW always visible (null moduleKey items)
    expect(screen.getByText("OVERVIEW")).toBeInTheDocument();
  });

  it("shows all items when enabledModules is null (backward compatible)", () => {
    render(<Sidebar enabledModules={null} />);
    expect(screen.getByRole("link", { name: /Finance/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /HR & Payroll/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Procurement/ })).toBeInTheDocument();
  });

  it("renders user avatar in footer", () => {
    render(<Sidebar />);
    expect(screen.getByText("D. Nayak")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });
});
