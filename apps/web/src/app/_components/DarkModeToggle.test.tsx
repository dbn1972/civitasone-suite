import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DarkModeToggle } from "./DarkModeToggle";

describe("DarkModeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("renders a button", () => {
    render(<DarkModeToggle />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("defaults to light theme icon", () => {
    render(<DarkModeToggle />);
    expect(screen.getByRole("button")).toHaveTextContent("☀️");
  });

  it("cycles to dark on first click", () => {
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("🌙");
  });

  it("cycles to system on second click", () => {
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("💻");
  });

  it("persists theme choice to localStorage", () => {
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button"));
    expect(localStorage.getItem("civitas-theme")).toBe("dark");
  });

  it("reads initial theme from localStorage", () => {
    localStorage.setItem("civitas-theme", "dark");
    render(<DarkModeToggle />);
    expect(screen.getByRole("button")).toHaveTextContent("🌙");
  });

  it("adds dark class to documentElement in dark mode", () => {
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button")); // → dark
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class in light mode", () => {
    document.documentElement.classList.add("dark");
    localStorage.setItem("civitas-theme", "dark");
    render(<DarkModeToggle />);
    fireEvent.click(screen.getByRole("button")); // dark → system
    fireEvent.click(screen.getByRole("button")); // system → light
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  describe("storage hardening (CLOS2-S3-02)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("does not throw and still toggles the dark class when storage is blocked", () => {
      const blocked = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
      render(<DarkModeToggle />);
      fireEvent.click(screen.getByRole("button")); // light -> dark
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(screen.getByRole("button")).toHaveTextContent("🌙");
    });

    it("ignores a junk stored value and keeps the light default", () => {
      localStorage.setItem("civitas-theme", "bogus");
      render(<DarkModeToggle />);
      expect(screen.getByRole("button")).toHaveTextContent("☀️");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });
});
