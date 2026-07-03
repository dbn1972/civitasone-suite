import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";

// Mock Sidebar and TopBar since they have their own tests
vi.mock("./Sidebar", () => ({ Sidebar: ({ enabledModules }: { enabledModules?: string[] | null }) => <nav data-testid="sidebar" data-modules={JSON.stringify(enabledModules)}>Sidebar</nav> }));
vi.mock("./TopBar", () => ({ TopBar: ({ crumb }: { crumb?: React.ReactNode }) => <header data-testid="topbar">{crumb}</header> }));

describe("AppShell", () => {
  it("renders children in main content area", () => {
    render(<AppShell><div>Page content</div></AppShell>);
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("renders sidebar", () => {
    render(<AppShell><div>content</div></AppShell>);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("renders topbar", () => {
    render(<AppShell><div>content</div></AppShell>);
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
  });

  it("passes crumb to TopBar", () => {
    render(<AppShell crumb={<span>Home / Finance</span>}><div>content</div></AppShell>);
    expect(screen.getByText("Home / Finance")).toBeInTheDocument();
  });

  it("main has correct id and tabIndex for skip-to-content", () => {
    render(<AppShell><div>content</div></AppShell>);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});
