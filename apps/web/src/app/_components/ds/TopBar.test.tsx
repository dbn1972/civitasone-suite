import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";

// Mock the sub-components
vi.mock("../GlobalSearch", () => ({ GlobalSearch: () => <div data-testid="search-modal" /> }));
vi.mock("../NotificationBell", () => ({ NotificationBell: () => <button>🔔</button> }));
vi.mock("../DarkModeToggle", () => ({ DarkModeToggle: () => <button>☀️</button> }));
vi.mock("../ConnectionStatus", () => ({ ConnectionStatus: () => null }));
vi.mock("../AccountMenu", () => ({ AccountMenu: () => <button>Account</button> }));

describe("TopBar", () => {
  it("renders header element", () => {
    render(<TopBar />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("renders breadcrumb navigation", () => {
    render(<TopBar />);
    expect(screen.getByLabelText("Breadcrumb")).toBeInTheDocument();
  });

  it("shows CivitasOne brand when no crumb provided", () => {
    render(<TopBar />);
    expect(screen.getByText("CivitasOne")).toBeInTheDocument();
  });

  it("renders custom crumb when provided", () => {
    render(<TopBar crumb={<span>Finance / Bills</span>} />);
    expect(screen.getByText("Finance / Bills")).toBeInTheDocument();
  });

  it("renders search trigger button", () => {
    // C-01: the readOnly input trap was replaced with a semantic button that
    // opens the GlobalSearch modal (Ctrl+K), so query for that button.
    render(<TopBar />);
    expect(screen.getByRole("button", { name: "Open search" })).toBeInTheDocument();
  });

  it("renders actions area with sub-components", () => {
    render(<TopBar />);
    expect(screen.getByTestId("search-modal")).toBeInTheDocument();
  });
});
