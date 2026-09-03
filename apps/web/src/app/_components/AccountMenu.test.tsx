import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountMenu } from "./AccountMenu";

vi.mock("@/lib/sync/logout", () => ({
  performLogout: vi.fn().mockResolvedValue(undefined),
}));

describe("AccountMenu", () => {
  it("renders account button with avatar", () => {
    render(<AccountMenu />);
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });

  it("has aria-haspopup=menu and aria-expanded=false initially", () => {
    render(<AccountMenu />);
    const btn = screen.getByRole("button", { name: "Account menu" });
    expect(btn).toHaveAttribute("aria-haspopup", "menu");
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("opens menu on click", () => {
    render(<AccountMenu name="Priya Sharma" />);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });

  it("sets aria-expanded=true when open", () => {
    render(<AccountMenu />);
    const btn = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("shows sign out button in menu", () => {
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    // Preferences (Appearance, Language) also render as menuitems; scope to Sign out.
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("uses default name when not provided", () => {
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    // Default fallback is the generic "User", not a hardcoded person — real callers
    // (TopBar) pass the actual signed-in userName from the session/JWT.
    expect(screen.getByText("User")).toBeInTheDocument();
  });

  it("closes menu on second click", () => {
    render(<AccountMenu />);
    const btn = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(btn);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
